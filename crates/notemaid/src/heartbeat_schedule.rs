//! HEARTBEAT の巡回の時刻決め (#411 / #1106)。notemaid の常駐 timer とアプリの
//! in-process timer が同じ規則を使う。
//!
//! OS のスリープ / ハイバネート中はプロセスごと止まり、単調時計 (tokio の interval) は
//! 寝ていた時間を数えない (Linux / macOS)。単調時計だけで刻むと、30 分間隔で一晩寝た
//! あと起きてから最大 30 分何も起きない。そこで:
//!
//! - 期限は **実時計** で見る (前回の巡回 + 間隔)。寝ていた時間も数える
//! - 実時計と単調時計の進み方の差で **復帰** を検知し、期限を過ぎていれば 1 回だけ巡回する
//!   (溜まった回数をまとめて走らせない)
//! - 復帰直後はネットワークが戻っていないことが多いので、少し待ってから走らせる
//! - 復帰後の巡回は前回からの経過を AI に渡す (「寝ている間のまとめ」を書けるように)

use std::time::Duration;

/// 実時計を見に行く間隔。復帰の検知と期限の判定の粒度
pub const POLL: Duration = Duration::from_secs(30);
/// 実時計の進みがこれだけ単調時計を上回ったら「寝ていた」とみなす
pub const RESUME_THRESHOLD: Duration = Duration::from_secs(120);
/// 復帰してから巡回するまでの待ち (ネットワークの復帰待ち)
pub const RESUME_GRACE: Duration = Duration::from_secs(30);

/// 巡回の理由。`run_once` の source と、AI に渡す経過時間
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Due {
    Scheduled,
    /// 復帰後の巡回。前回の巡回からの経過 (実時計)
    Resumed {
        since_last: Duration,
    },
}

impl Due {
    pub fn source(&self) -> &'static str {
        match self {
            Due::Scheduled => "scheduled",
            Due::Resumed { .. } => "resumed",
        }
    }

    pub fn gap(&self) -> Option<Duration> {
        match self {
            Due::Scheduled => None,
            Due::Resumed { since_last } => Some(*since_last),
        }
    }
}

/// 時刻を外から渡す状態機械 (テストで時計を動かせるように)。単位は ms
#[derive(Clone, Debug)]
pub struct Schedule {
    interval_ms: u64,
    last_run_wall: u64,
    last_poll_wall: u64,
    last_poll_mono: u64,
    /// 復帰を検知した単調時刻 (待ちの起点)
    resumed_at_mono: Option<u64>,
}

impl Schedule {
    /// 起動の時点を前回の巡回とみなす (起動直後に走らせない、従来の timer と同じ)
    pub fn new(interval: Duration, now_wall: u64, now_mono: u64) -> Self {
        Self {
            interval_ms: interval.as_millis() as u64,
            last_run_wall: now_wall,
            last_poll_wall: now_wall,
            last_poll_mono: now_mono,
            resumed_at_mono: None,
        }
    }

    /// 1 回見に行く。巡回すべきなら理由を返し、前回の巡回時刻を今に進める
    pub fn poll(&mut self, now_wall: u64, now_mono: u64) -> Option<Due> {
        let wall_delta = now_wall.saturating_sub(self.last_poll_wall);
        let mono_delta = now_mono.saturating_sub(self.last_poll_mono);
        self.last_poll_wall = now_wall;
        self.last_poll_mono = now_mono;
        // 実時計が戻った (時刻合わせ) なら、そこを起点にし直す
        if now_wall < self.last_run_wall {
            self.last_run_wall = now_wall;
        }
        if wall_delta > mono_delta + RESUME_THRESHOLD.as_millis() as u64 {
            self.resumed_at_mono = Some(now_mono);
        }
        let due = now_wall >= self.last_run_wall + self.interval_ms;
        if let Some(at) = self.resumed_at_mono {
            if now_mono.saturating_sub(at) < RESUME_GRACE.as_millis() as u64 {
                return None;
            }
            self.resumed_at_mono = None;
            if due {
                let since_last = Duration::from_millis(now_wall - self.last_run_wall);
                self.last_run_wall = now_wall;
                return Some(Due::Resumed { since_last });
            }
            return None;
        }
        if due {
            self.last_run_wall = now_wall;
            return Some(Due::Scheduled);
        }
        None
    }
}

/// 実時計 (UNIX ms)
pub fn wall_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 巡回の timer 本体。`POLL` ごとに見に行き、期限なら `tick` を呼ぶ。止めるのは呼び出し側の abort
pub async fn run<F, Fut>(interval: Duration, mut tick: F)
where
    F: FnMut(Due) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let origin = tokio::time::Instant::now();
    let mono = move || origin.elapsed().as_millis() as u64;
    let mut schedule = Schedule::new(interval, wall_ms(), mono());
    let mut ticker = tokio::time::interval(POLL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker.tick().await;
    loop {
        ticker.tick().await;
        if let Some(due) = schedule.poll(wall_ms(), mono()) {
            if let Due::Resumed { since_last } = &due {
                tracing::info!(
                    minutes = since_last.as_secs() / 60,
                    "[heartbeat] resumed from sleep; running one round"
                );
            }
            tick(due).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = 60_000;
    const S: u64 = 1_000;

    /// 起きている間は実時計と単調時計が同じだけ進む
    fn awake(s: &mut Schedule, wall: &mut u64, mono: &mut u64, ms: u64) -> Vec<Due> {
        let mut out = Vec::new();
        let step = POLL.as_millis() as u64;
        let mut left = ms;
        while left > 0 {
            let d = left.min(step);
            *wall += d;
            *mono += d;
            left -= d;
            if let Some(due) = s.poll(*wall, *mono) {
                out.push(due);
            }
        }
        out
    }

    #[test]
    fn runs_once_per_interval_while_awake() {
        let (mut wall, mut mono) = (1_000_000, 0);
        let mut s = Schedule::new(Duration::from_millis(30 * MIN), wall, mono);
        let runs = awake(&mut s, &mut wall, &mut mono, 29 * MIN);
        assert!(runs.is_empty(), "not before the interval");
        let runs = awake(&mut s, &mut wall, &mut mono, 2 * MIN);
        assert_eq!(runs, vec![Due::Scheduled]);
        let runs = awake(&mut s, &mut wall, &mut mono, 60 * MIN);
        assert_eq!(runs.len(), 2);
    }

    #[test]
    fn after_a_night_of_sleep_runs_once_after_the_grace_with_the_gap() {
        let (mut wall, mut mono) = (1_000_000, 0);
        let mut s = Schedule::new(Duration::from_millis(30 * MIN), wall, mono);
        awake(&mut s, &mut wall, &mut mono, 25 * MIN);
        // 9 時間寝る: 実時計だけ進む
        wall += 9 * 60 * MIN;
        // 復帰直後の 1 回目は待ち (ネットワークの復帰待ち)
        mono += 1;
        wall += 1;
        assert_eq!(s.poll(wall, mono), None);
        let runs = awake(&mut s, &mut wall, &mut mono, 40 * S);
        assert_eq!(runs.len(), 1, "exactly one round, no burst of missed ones");
        let Due::Resumed { since_last } = &runs[0] else {
            panic!("expected a resumed round, got {:?}", runs[0]);
        };
        assert!(since_last.as_secs() >= 9 * 3600);
        assert_eq!(runs[0].source(), "resumed");
        // その後は通常の間隔に戻る
        let runs = awake(&mut s, &mut wall, &mut mono, 29 * MIN);
        assert!(runs.is_empty());
    }

    #[test]
    fn a_short_nap_before_the_deadline_does_not_run_early() {
        let (mut wall, mut mono) = (1_000_000, 0);
        let mut s = Schedule::new(Duration::from_millis(30 * MIN), wall, mono);
        awake(&mut s, &mut wall, &mut mono, 5 * MIN);
        wall += 10 * MIN; // 10 分寝る (期限前)
        mono += 1;
        let runs = awake(&mut s, &mut wall, &mut mono, 2 * MIN);
        assert!(runs.is_empty());
        // 寝ていた時間も数えるので、起動から 30 分で走る
        let runs = awake(&mut s, &mut wall, &mut mono, 14 * MIN);
        assert_eq!(runs, vec![Due::Scheduled]);
    }

    #[test]
    fn wall_clock_going_back_restarts_the_count() {
        let (mut wall, mut mono) = (10_000_000, 0);
        let mut s = Schedule::new(Duration::from_millis(30 * MIN), wall, mono);
        awake(&mut s, &mut wall, &mut mono, 10 * MIN);
        wall -= 60 * MIN; // 時刻合わせで 1 時間戻る
        let runs = awake(&mut s, &mut wall, &mut mono, 29 * MIN);
        assert!(runs.is_empty());
        let runs = awake(&mut s, &mut wall, &mut mono, 2 * MIN);
        assert_eq!(runs, vec![Due::Scheduled]);
    }
}

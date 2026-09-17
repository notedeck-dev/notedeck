//! OS の電源・回線・集中モードの状態を読む (#931 / #935 / #928)。
//!
//! Web API では取れない領域 (Battery Status API は WebKit に無く、従量制と
//! 集中モードは API 自体が存在しない) なので Rust 側で OS を叩き、変化した
//! ときだけ [`SystemState`] を event で配る。「何を落とすか」の判断はフロント
//! (`src/services/systemAdaptation.ts`) に置き、ここは事実の観測だけを担う。
//!
//! 取得手段は OS ごとに違う ([`platform`])。取れない項目は `None` で、フロント
//! は None を「非対応 = 通常どおり」として扱う。取れないプラットフォームに
//! 代替トグルは作らない (issue の方針)。
//!
//! | 項目 | Linux | macOS | Windows |
//! |---|---|---|---|
//! | on_battery | starship-battery (/sys) | starship-battery (IOKit) | GetSystemPowerStatus |
//! | low_power_mode | power-profiles-daemon (D-Bus) | NSProcessInfo | GetSystemPowerStatus (battery saver) |
//! | metered | NetworkManager (D-Bus) | Network.framework (nw_path_monitor) | WinRT ConnectionCost |
//! | do_not_disturb | org.freedesktop.Notifications `Inhibited` / GNOME gsettings | DoNotDisturb DB (private) | WNF quiet hours (undocumented) |
//!
//! Android / iOS は全項目 None (未対応)。
//!
//! 変化の検知はポーリング (30 秒)。OS ごとの変更通知 API を個別に配線する
//! より単純で、ここで落とす対象 (先読み・絵文字アニメ・通知音) に秒単位の
//! 即応性は要らない。

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// ポーリング間隔。
const POLL_INTERVAL: Duration = Duration::from_secs(30);

/// OS 状態のスナップショット。`None` = その項目をこのプラットフォームでは
/// 取得できない (または取得に失敗した)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SystemState {
    /// バッテリー駆動中 (AC 未接続で放電中)。バッテリーの無い机上機は None
    pub on_battery: Option<bool>,
    /// OS の省電力モードが有効 (macOS 低電力モード / Windows バッテリー
    /// 節約機能 / Linux power-profiles-daemon の power-saver)
    pub low_power_mode: Option<bool>,
    /// 現在のインターネット接続が従量制 (テザリング・モバイル回線等)
    pub metered: Option<bool>,
    /// OS の集中モード / おやすみモードが有効
    pub do_not_disturb: Option<bool>,
}

/// 直近のスナップショット。command から読み出す。
pub type SharedSystemState = Arc<Mutex<SystemState>>;

/// 生の観測値をスナップショットの各項目に落とす純関数群。
/// OS API の戻り値をそのまま渡せる形にして、ここだけを単体テストする。
pub mod signals {
    /// バッテリー群から on_battery を決める。1 台でも放電中なら on_battery。
    /// バッテリーが 1 台も無い (机上機) なら None。
    #[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
    pub fn on_battery(discharging: impl IntoIterator<Item = bool>) -> Option<bool> {
        let mut any = false;
        let mut result = false;
        for d in discharging {
            any = true;
            result |= d;
        }
        any.then_some(result)
    }

    /// power-profiles-daemon の ActiveProfile ("power-saver" / "balanced" /
    /// "performance")。
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn low_power_from_profile(profile: &str) -> bool {
        profile == "power-saver"
    }

    /// NetworkManager の `Metered` プロパティ (NMMetered)。
    /// 0 unknown / 1 yes / 2 no / 3 guess-yes / 4 guess-no
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn metered_from_nm(value: u32) -> Option<bool> {
        match value {
            1 | 3 => Some(true),
            2 | 4 => Some(false),
            _ => None,
        }
    }

    /// WinRT `ConnectionCost`。`NetworkCostType` は 0 Unknown / 1 Unrestricted /
    /// 2 Fixed / 3 Variable。ローミング中やデータ上限超過は種別によらず従量制
    /// として扱う。
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn metered_from_cost(cost_type: i32, roaming: bool, over_data_limit: bool) -> Option<bool> {
        if roaming || over_data_limit {
            return Some(true);
        }
        match cost_type {
            1 => Some(false),
            2 | 3 => Some(true),
            _ => None,
        }
    }

    /// Windows の quiet hours (Focus Assist / 応答不可) の WNF 値。
    /// 0 off / 1 priority only / 2 alarms only。非ゼロなら集中モード。
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn dnd_from_quiet_hours(value: u32) -> bool {
        value != 0
    }

    /// macOS の `~/Library/DoNotDisturb/DB/Assertions.json`。手動で有効化した
    /// 集中モードは `storeAssertionRecords` にレコードが積まれる。
    /// 形式が読めなければ None (OS 更新で変わり得る private な DB)。
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn dnd_from_assertions_json(json: &str) -> Option<bool> {
        let v: serde_json::Value = serde_json::from_str(json).ok()?;
        let data = v.get("data")?.as_array()?;
        let active = data.iter().any(|entry| {
            entry
                .get("storeAssertionRecords")
                .and_then(|r| r.as_array())
                .is_some_and(|r| !r.is_empty())
        });
        Some(active)
    }
}

/// 変化検知。前回値と比較し、変わったときだけ `Some` を返す。
/// 初回は必ず変化扱い (フロントは起動時に一度は受け取りたい)。
#[derive(Default)]
pub struct Tracker {
    last: Option<SystemState>,
}

impl Tracker {
    pub fn observe(&mut self, next: SystemState) -> Option<SystemState> {
        if self.last == Some(next) {
            return None;
        }
        self.last = Some(next);
        Some(next)
    }
}

/// 常駐ループ。起動直後に 1 回、その後 [`POLL_INTERVAL`] ごとに観測し、
/// 変化時だけ shared を更新して event を emit する。
pub async fn run_monitor(app: tauri::AppHandle, shared: SharedSystemState) {
    let mut tracker = Tracker::default();
    loop {
        let next = platform::probe().await;
        if let Some(changed) = tracker.observe(next) {
            *shared.lock().unwrap_or_else(|p| p.into_inner()) = changed;
            tracing::debug!(?changed, "system state changed");
            if let Err(e) = changed.emit(&app) {
                tracing::warn!(error = %e, "failed to emit system state");
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// OS ごとの観測。各項目は独立に失敗して None になる。
pub mod platform {
    use super::SystemState;

    #[cfg(target_os = "linux")]
    pub async fn probe() -> SystemState {
        SystemState {
            on_battery: battery::on_battery(),
            low_power_mode: linux::low_power_mode().await,
            metered: linux::metered().await,
            do_not_disturb: linux::do_not_disturb().await,
        }
    }

    #[cfg(target_os = "macos")]
    pub async fn probe() -> SystemState {
        SystemState {
            on_battery: battery::on_battery(),
            low_power_mode: macos::low_power_mode(),
            metered: macos::metered(),
            do_not_disturb: macos::do_not_disturb(),
        }
    }

    #[cfg(target_os = "windows")]
    pub async fn probe() -> SystemState {
        let (on_battery, low_power_mode) = windows::power_status();
        SystemState {
            on_battery,
            low_power_mode,
            metered: windows::metered(),
            do_not_disturb: windows::do_not_disturb(),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    pub async fn probe() -> SystemState {
        SystemState::default()
    }

    /// starship-battery (Linux は /sys、macOS は IOKit)。Windows は
    /// GetSystemPowerStatus 1 回で節約機能まで取れるので使わない。
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    mod battery {
        use super::super::signals;

        pub fn on_battery() -> Option<bool> {
            let manager = starship_battery::Manager::new().ok()?;
            let batteries = manager.batteries().ok()?;
            let discharging: Vec<bool> = batteries
                .filter_map(|b| b.ok())
                .map(|b| b.state() == starship_battery::State::Discharging)
                .collect();
            signals::on_battery(discharging)
        }
    }

    #[cfg(target_os = "linux")]
    mod linux {
        use super::super::signals;
        use zbus::zvariant::OwnedValue;

        async fn get_property(
            conn: &zbus::Connection,
            destination: &str,
            path: &str,
            interface: &str,
            property: &str,
        ) -> Option<OwnedValue> {
            let proxy = zbus::fdo::PropertiesProxy::builder(conn)
                .destination(destination.to_string())
                .ok()?
                .path(path.to_string())
                .ok()?
                .build()
                .await
                .ok()?;
            let iface = zbus::names::InterfaceName::try_from(interface.to_string()).ok()?;
            proxy.get(iface, property).await.ok()
        }

        /// power-profiles-daemon。0.20 以降は org.freedesktop.UPower.PowerProfiles
        /// 名も持つが、互換のため旧名 net.hadess.PowerProfiles も残っている。
        /// 新旧どちらでも取れるよう両方試す。
        pub async fn low_power_mode() -> Option<bool> {
            let conn = zbus::Connection::system().await.ok()?;
            for (dest, path, iface) in [
                (
                    "org.freedesktop.UPower.PowerProfiles",
                    "/org/freedesktop/UPower/PowerProfiles",
                    "org.freedesktop.UPower.PowerProfiles",
                ),
                (
                    "net.hadess.PowerProfiles",
                    "/net/hadess/PowerProfiles",
                    "net.hadess.PowerProfiles",
                ),
            ] {
                if let Some(v) = get_property(&conn, dest, path, iface, "ActiveProfile").await {
                    let profile = String::try_from(v).ok()?;
                    return Some(signals::low_power_from_profile(&profile));
                }
            }
            None
        }

        /// NetworkManager の `Metered` (アクティブ接続から推定した値)。
        pub async fn metered() -> Option<bool> {
            let conn = zbus::Connection::system().await.ok()?;
            let v = get_property(
                &conn,
                "org.freedesktop.NetworkManager",
                "/org/freedesktop/NetworkManager",
                "org.freedesktop.NetworkManager",
                "Metered",
            )
            .await?;
            signals::metered_from_nm(u32::try_from(v).ok()?)
        }

        /// 通知デーモンの `Inhibited` (Notifications spec 1.3、KDE Plasma 等)。
        /// GNOME はプロパティを実装していないので gsettings の
        /// show-banners (おやすみモードで false になる) を見る。
        pub async fn do_not_disturb() -> Option<bool> {
            if let Some(v) = async {
                let conn = zbus::Connection::session().await.ok()?;
                get_property(
                    &conn,
                    "org.freedesktop.Notifications",
                    "/org/freedesktop/Notifications",
                    "org.freedesktop.Notifications",
                    "Inhibited",
                )
                .await
            }
            .await
            {
                return bool::try_from(v).ok();
            }
            gnome_show_banners().await.map(|shown| !shown)
        }

        async fn gnome_show_banners() -> Option<bool> {
            let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
            if !desktop.to_ascii_lowercase().contains("gnome") {
                return None;
            }
            // tokio の process feature は入れていないので blocking pool で回す
            let out = tokio::task::spawn_blocking(|| {
                std::process::Command::new("gsettings")
                    .args(["get", "org.gnome.desktop.notifications", "show-banners"])
                    .output()
            })
            .await
            .ok()?
            .ok()?;
            if !out.status.success() {
                return None;
            }
            match String::from_utf8_lossy(&out.stdout).trim() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            }
        }
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use std::ffi::c_void;
        use std::sync::atomic::{AtomicU8, Ordering};
        use std::sync::OnceLock;

        use super::super::signals;

        pub fn low_power_mode() -> Option<bool> {
            Some(objc2_foundation::NSProcessInfo::processInfo().isLowPowerModeEnabled())
        }

        /// 集中モードの DB (private)。macOS 26 では場所が変わったとの報告が
        /// あり、読めなければ None (非対応扱い) に落ちる。
        pub fn do_not_disturb() -> Option<bool> {
            let home = std::env::var("HOME").ok()?;
            let path = std::path::Path::new(&home).join("Library/DoNotDisturb/DB/Assertions.json");
            let json = std::fs::read_to_string(path).ok()?;
            signals::dnd_from_assertions_json(&json)
        }

        // Network.framework の C API。objc2-network は 0.0.0 の placeholder
        // しか無いので手で宣言する。nw_path_monitor は更新ハンドラでしか
        // path を渡してこないため、初回に monitor を起動して最新値を
        // static に書き、probe はそれを読む。
        type NwObject = *mut c_void;

        #[link(name = "Network", kind = "framework")]
        extern "C" {
            fn nw_path_monitor_create() -> NwObject;
            fn nw_path_monitor_set_update_handler(
                monitor: NwObject,
                handler: &block2::Block<dyn Fn(NwObject)>,
            );
            fn nw_path_monitor_set_queue(monitor: NwObject, queue: NwObject);
            fn nw_path_monitor_start(monitor: NwObject);
            fn nw_path_is_expensive(path: NwObject) -> bool;
            fn nw_path_is_constrained(path: NwObject) -> bool;
        }

        extern "C" {
            fn dispatch_get_global_queue(identifier: isize, flags: usize) -> NwObject;
        }

        const UNKNOWN: u8 = 0;
        const NOT_METERED: u8 = 1;
        const METERED: u8 = 2;

        static METERED_STATE: AtomicU8 = AtomicU8::new(UNKNOWN);
        /// monitor とハンドラは process 寿命で保持する (解放しない)。
        static MONITOR: OnceLock<usize> = OnceLock::new();

        fn start_monitor() -> usize {
            let handler = block2::RcBlock::new(|path: NwObject| {
                // isExpensive = セルラー/テザリング、isConstrained = 低データモード。
                // どちらも「通信量を気にする回線」なので従量制として扱う
                let metered = unsafe { nw_path_is_expensive(path) || nw_path_is_constrained(path) };
                METERED_STATE.store(
                    if metered { METERED } else { NOT_METERED },
                    Ordering::Relaxed,
                );
            });
            unsafe {
                let monitor = nw_path_monitor_create();
                if monitor.is_null() {
                    return 0;
                }
                nw_path_monitor_set_update_handler(monitor, &handler);
                nw_path_monitor_set_queue(monitor, dispatch_get_global_queue(0, 0));
                nw_path_monitor_start(monitor);
                // set_update_handler は block をコピーして保持するが、
                // 念のため自前の参照も落とさない
                std::mem::forget(handler);
                monitor as usize
            }
        }

        pub fn metered() -> Option<bool> {
            MONITOR.get_or_init(start_monitor);
            match METERED_STATE.load(Ordering::Relaxed) {
                METERED => Some(true),
                NOT_METERED => Some(false),
                _ => None,
            }
        }
    }

    #[cfg(target_os = "windows")]
    mod windows {
        use std::ffi::c_void;

        use windows::core::{s, w};
        use windows::Networking::Connectivity::NetworkInformation;
        use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

        use super::super::signals;

        /// (on_battery, low_power_mode)。
        /// ACLineStatus: 0 = バッテリー / 1 = AC / 255 = 不明。
        /// BatteryFlag bit 128 = バッテリー無し。SystemStatusFlag 1 = 節約機能 ON。
        pub fn power_status() -> (Option<bool>, Option<bool>) {
            let mut status = SYSTEM_POWER_STATUS::default();
            if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
                return (None, None);
            }
            let has_battery = status.BatteryFlag & 128 == 0;
            let on_battery = match (has_battery, status.ACLineStatus) {
                (false, _) => None,
                (true, 0) => Some(true),
                (true, 1) => Some(false),
                _ => None,
            };
            (on_battery, Some(status.SystemStatusFlag == 1))
        }

        pub fn metered() -> Option<bool> {
            let profile = NetworkInformation::GetInternetConnectionProfile().ok()?;
            let cost = profile.GetConnectionCost().ok()?;
            signals::metered_from_cost(
                cost.NetworkCostType().ok()?.0,
                cost.Roaming().ok()?,
                cost.OverDataLimit().ok()?,
            )
        }

        // WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED。公開 API が無いため
        // ntdll の未公開関数を動的に引く。無ければ None (非対応扱い)。
        const WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED: u64 = 0x0D83_063E_A3BF_1C75;

        type NtQueryWnfStateData = unsafe extern "system" fn(
            state_name: *const u64,
            type_id: *const c_void,
            explicit_scope: *const c_void,
            change_stamp: *mut u32,
            buffer: *mut c_void,
            buffer_size: *mut u32,
        ) -> i32;

        pub fn do_not_disturb() -> Option<bool> {
            let query: NtQueryWnfStateData = unsafe {
                let ntdll = GetModuleHandleW(w!("ntdll.dll")).ok()?;
                let addr = GetProcAddress(ntdll, s!("NtQueryWnfStateData"))?;
                std::mem::transmute(addr)
            };
            let mut change_stamp = 0u32;
            let mut value = 0u32;
            let mut size = std::mem::size_of::<u32>() as u32;
            let status = unsafe {
                query(
                    &WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED,
                    std::ptr::null(),
                    std::ptr::null(),
                    &mut change_stamp,
                    (&mut value as *mut u32).cast(),
                    &mut size,
                )
            };
            (status == 0 && size == std::mem::size_of::<u32>() as u32)
                .then(|| signals::dnd_from_quiet_hours(value))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::signals::*;
    use super::*;

    #[test]
    fn on_battery_requires_at_least_one_battery() {
        assert_eq!(on_battery([]), None);
        assert_eq!(on_battery([false]), Some(false));
        assert_eq!(on_battery([true]), Some(true));
        // 2 台構成 (ThinkPad 等) は片方が放電中ならバッテリー駆動
        assert_eq!(on_battery([false, true]), Some(true));
    }

    #[test]
    fn low_power_profile_is_only_power_saver() {
        assert!(low_power_from_profile("power-saver"));
        assert!(!low_power_from_profile("balanced"));
        assert!(!low_power_from_profile("performance"));
    }

    #[test]
    fn nm_metered_maps_guesses_and_unknown() {
        assert_eq!(metered_from_nm(0), None);
        assert_eq!(metered_from_nm(1), Some(true));
        assert_eq!(metered_from_nm(2), Some(false));
        assert_eq!(metered_from_nm(3), Some(true));
        assert_eq!(metered_from_nm(4), Some(false));
        assert_eq!(metered_from_nm(99), None);
    }

    #[test]
    fn windows_cost_treats_roaming_and_over_limit_as_metered() {
        assert_eq!(metered_from_cost(0, false, false), None);
        assert_eq!(metered_from_cost(1, false, false), Some(false));
        assert_eq!(metered_from_cost(2, false, false), Some(true));
        assert_eq!(metered_from_cost(3, false, false), Some(true));
        assert_eq!(metered_from_cost(1, true, false), Some(true));
        assert_eq!(metered_from_cost(0, false, true), Some(true));
    }

    #[test]
    fn quiet_hours_nonzero_is_dnd() {
        assert!(!dnd_from_quiet_hours(0));
        assert!(dnd_from_quiet_hours(1));
        assert!(dnd_from_quiet_hours(2));
    }

    #[test]
    fn assertions_json_detects_active_focus() {
        let active = r#"{"data":[{"storeAssertionRecords":[{"assertionDetails":{"assertionDetailsModeIdentifier":"com.apple.donotdisturb.mode.default"}}]}]}"#;
        assert_eq!(dnd_from_assertions_json(active), Some(true));
        let idle = r#"{"data":[{"storeAssertionRecords":[]}]}"#;
        assert_eq!(dnd_from_assertions_json(idle), Some(false));
        let no_records = r#"{"data":[{}]}"#;
        assert_eq!(dnd_from_assertions_json(no_records), Some(false));
        // 形式が変わって読めなければ非対応扱い (勝手に「集中モード」にしない)
        assert_eq!(dnd_from_assertions_json("not json"), None);
        assert_eq!(dnd_from_assertions_json(r#"{"other":1}"#), None);
    }

    #[test]
    fn tracker_emits_first_and_changes_only() {
        let mut t = Tracker::default();
        let a = SystemState {
            on_battery: Some(true),
            ..Default::default()
        };
        assert_eq!(t.observe(a), Some(a));
        assert_eq!(t.observe(a), None);
        let b = SystemState {
            on_battery: Some(false),
            ..Default::default()
        };
        assert_eq!(t.observe(b), Some(b));
        assert_eq!(t.observe(b), None);
    }

    #[test]
    fn tracker_reports_default_snapshot_once() {
        // 全項目 None (非対応環境) でもフロントは起動時に 1 回受け取る
        let mut t = Tracker::default();
        assert_eq!(
            t.observe(SystemState::default()),
            Some(SystemState::default())
        );
        assert_eq!(t.observe(SystemState::default()), None);
    }
}

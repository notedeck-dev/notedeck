//! Microsoft Store 版 (MSIX) の中で動いているかの見分け (#849)。
//!
//! Store 版と直接配布版 (NSIS / portable) は同じ exe で、違いは実行時に OS へ聞く。
//! 共有クレートに置かないのは、必要なのがアプリだけだから (子の notemaid には、
//! データの場所も資格情報の名前も引数で渡す)。
//!
//! 外から偽れる口 (環境変数など) は作らない: 「中」と思わせられると updater が止まる。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use notecore::app_dir::APP_IDENTIFIER;

/// `GetCurrentPackageFamilyName` が、パッケージの外で返す値 (APPMODEL_ERROR_NO_PACKAGE)。
/// 外ではこれが正常な答えで、エラーではない。Windows 以外では OS に聞かないので、テストだけが使う
#[cfg_attr(not(windows), allow(dead_code))]
const NO_PACKAGE: u32 = 15700;
#[cfg_attr(not(windows), allow(dead_code))]
const SUCCESS: u32 = 0;
#[cfg(windows)]
const INSUFFICIENT_BUFFER: u32 = 122;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Packaging {
    /// 直接配布。Windows 以外は常にこれ
    Outside,
    /// MSIX の中。名前はパッケージ専用の場所を組むのに使う
    Inside { family_name: String },
    /// 聞いたが答えが取れなかった。自分で自分を更新・登録する処理は止める (中と同じ) が、
    /// 専用の場所は組めないのでデータは今までどおりにする
    Unknown,
}

impl Packaging {
    /// updater とプロトコルの実行時登録を止めるか。誤って動かすと、直接配布版を別に入れたり、
    /// 外から起動できないパスを登録したりするので、不明のときも止める
    pub fn manages_itself(&self) -> bool {
        matches!(self, Packaging::Outside)
    }

    pub fn family_name(&self) -> Option<&str> {
        match self {
            Packaging::Inside { family_name } => Some(family_name),
            _ => None,
        }
    }
}

/// OS の答えを 3 つの状態に直す
#[cfg_attr(not(windows), allow(dead_code))]
fn classify(code: u32, family_name: Option<String>) -> Packaging {
    match (code, family_name) {
        (NO_PACKAGE, _) => Packaging::Outside,
        (SUCCESS, Some(name)) if !name.is_empty() => Packaging::Inside { family_name: name },
        _ => Packaging::Unknown,
    }
}

#[cfg(windows)]
fn query() -> (u32, Option<String>) {
    use windows::core::PWSTR;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFamilyName;

    let mut len = 0u32;
    // 長さ 0 で聞くと、中なら「バッファが足りない」と必要な長さが返る
    let code = unsafe { GetCurrentPackageFamilyName(&mut len, None) }.0;
    if code != INSUFFICIENT_BUFFER {
        return (code, None);
    }
    let mut buf = vec![0u16; len as usize];
    let code = unsafe { GetCurrentPackageFamilyName(&mut len, Some(PWSTR(buf.as_mut_ptr()))) }.0;
    let name = (code == SUCCESS)
        .then(|| String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)]));
    (code, name)
}

/// Store 版が資格情報を保存するサービス名。直接配布版 (`notedeck`) と分ける: 共有すると、
/// 同じ接続 id の鍵を片方で消したときにもう片方も失う
pub const KEYCHAIN_SERVICE: &str = "notedeck-msstore";

/// OS 通知を出すときに名乗る識別子。パッケージの中では OS が決めた自分の識別子でないと
/// 通知の口を作れない (作れないと通知ライブラリは黙って何も出さなくなる)
pub fn notification_app_id(default: String) -> String {
    #[cfg(windows)]
    if current().family_name().is_some() {
        use windows::core::PWSTR;
        use windows::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;

        let mut len = 0u32;
        if unsafe { GetCurrentApplicationUserModelId(&mut len, None) }.0 == INSUFFICIENT_BUFFER {
            let mut buf = vec![0u16; len as usize];
            let code = unsafe {
                GetCurrentApplicationUserModelId(&mut len, Some(PWSTR(buf.as_mut_ptr())))
            }
            .0;
            if code == SUCCESS {
                return String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)]);
            }
        }
        tracing::warn!(
            "[packaged] could not get the application user model id; notifications may not appear"
        );
    }
    default
}

/// このプロセスの状態。起動中に変わらないので 1 回だけ聞く
pub fn current() -> &'static Packaging {
    static CURRENT: OnceLock<Packaging> = OnceLock::new();
    CURRENT.get_or_init(|| {
        #[cfg(windows)]
        {
            let (code, name) = query();
            classify(code, name)
        }
        #[cfg(not(windows))]
        {
            Packaging::Outside
        }
    })
}

/// Store 版が使う、パッケージ専用の場所。OS の振り替えに任せず実体のパスを明示する:
/// 直接配布版のフォルダが残っている端末では、任せるとそちらをそのまま使ってしまう
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackagedDirs {
    /// アプリのデータ (DB・設定・記録・状態)
    pub data: PathBuf,
    /// ログと WebView のデータの親
    pub local: PathBuf,
}

impl PackagedDirs {
    pub fn logs(&self) -> PathBuf {
        self.local.join("logs")
    }
}

/// `local_app_data` は `%LOCALAPPDATA%` の実体。まっさらな端末で OS が振り替える先と同じ場所になる
pub fn dirs_for(local_app_data: &Path, family_name: &str) -> PackagedDirs {
    let cache = local_app_data
        .join("Packages")
        .join(family_name)
        .join("LocalCache");
    PackagedDirs {
        data: cache.join("Roaming").join(APP_IDENTIFIER),
        local: cache.join("Local").join(APP_IDENTIFIER),
    }
}

/// パッケージの中ならその専用の場所。外・不明は None (今までどおりの場所を使う)
pub fn dirs() -> Option<PackagedDirs> {
    let family_name = current().family_name()?;
    Some(dirs_for(&dirs::data_local_dir()?, family_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_a_package_is_the_normal_answer_not_an_error() {
        assert_eq!(classify(NO_PACKAGE, None), Packaging::Outside);
        assert!(classify(NO_PACKAGE, None).manages_itself());
    }

    #[test]
    fn a_family_name_means_inside() {
        let p = classify(SUCCESS, Some("NotedeckDev.NoteDeck_abc".into()));
        assert_eq!(p.family_name(), Some("NotedeckDev.NoteDeck_abc"));
        assert!(!p.manages_itself());
    }

    #[test]
    fn any_other_answer_is_unknown_and_stops_self_management() {
        for (code, name) in [(5, None), (SUCCESS, None), (SUCCESS, Some(String::new()))] {
            let p = classify(code, name);
            assert_eq!(p, Packaging::Unknown);
            assert!(!p.manages_itself());
            assert_eq!(p.family_name(), None);
        }
    }

    #[test]
    fn packaged_dirs_sit_under_the_package_and_never_under_the_real_appdata() {
        let d = dirs_for(Path::new("/u/AppData/Local"), "Fam_1");
        assert_eq!(
            d.data,
            Path::new("/u/AppData/Local/Packages/Fam_1/LocalCache/Roaming").join(APP_IDENTIFIER)
        );
        assert_eq!(
            d.logs(),
            Path::new("/u/AppData/Local/Packages/Fam_1/LocalCache/Local")
                .join(APP_IDENTIFIER)
                .join("logs")
        );
    }
}

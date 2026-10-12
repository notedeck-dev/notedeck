---
sourceHash: e5cbbdfad684
---

# 설치

OS별 설치 프로그램은 [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest)에서 배포합니다. 첫 페이지의 [다운로드](/ko/#download)에서도 바로 받을 수 있습니다.

| OS | 형식 |
|---|---|
| Windows | `.exe` (설치 프로그램) / portable `.zip` |
| macOS | `.dmg` (Universal — Intel / Apple Silicon 공통) / `.app`의 `.zip` |
| Linux | `.deb` / `.AppImage` / `.tar.gz` (앱 본체 + notemaid + systemd user unit) |
| Android | `.apk` (CPU별로 `arm64` / `armv7` / `x86_64` 3종. 실제 기기는 대부분 `arm64`) |

같은 Release에 AI 별도 프로세스 [notemaid](/ko/docs/notemaid)와 CLI인 notecli의 standalone 바이너리도 있습니다 (Linux와 Apple Silicon macOS용). 앱에는 notemaid가 함께 들어 있으므로 평소에는 필요 없습니다.

## 패키지 관리자

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin   # notemaid와 user unit 포함
yay -S notecli-bin            # CLI만 필요할 때
```

```bash [Nix Flake]
# 앱 본체는 아직 Nix로 배포하지 않습니다 (AppImage나 tarball을 쓰세요).
# flake가 제공하는 것은 notemaid (AI 별도 프로세스)와 CLI입니다
nix profile install 'github:notedeck-dev/notedeck#notemaid'
nix profile install 'github:notedeck-dev/notedeck#notecli'
```

:::

Nix로 notemaid를 상주시키려면 flake의 home-manager 모듈 (`services.notemaid.enable`)을 씁니다. 앱 안의 상주 토글은 Nix store 위의 바이너리를 등록할 수 없습니다.

## 처음 실행할 때의 경고

Windows / macOS 버전은 아직 코드 서명 없이 배포하고 있어, 처음 실행할 때 "알 수 없는 게시자" 경고가 표시됩니다.

- **Windows**: SmartScreen 화면에서 "추가 정보" → "실행"
- **macOS**: 시스템 설정 → "개인정보 보호 및 보안"에서 차단된 앱을 "그래도 열기" (오래된 macOS에서는 Finder에서 앱을 오른쪽 클릭 → "열기"로도 통과합니다)

서명이 없는 것은 비용과 심사의 문제이며, 악성 코드가 들어 있어서가 아닙니다. 배포물은 GitHub Actions가 공개 저장소의 소스에서 빌드하며, `.exe` / `.dmg` / `.deb` / `.AppImage` / `.tar.gz`는 `SHA256SUMS.txt`로 해시를 검증할 수 있습니다.

경고를 없애려면 Windows는 OSS용 무료 코드 서명 ([SignPath Foundation](https://signpath.org/)) 심사를 통과해야 하고, macOS는 Apple Developer Program을 통한 공증 (notarization)이 필요합니다. SignPath Foundation은 "아무도 모르는 소스 코드에는 서명할 수 없다"며 실제로 쓰이고 있는 실적을 보기 때문에, [GitHub의 Star](https://github.com/notedeck-dev/notedeck)와 다운로드 수가 그대로 근거가 됩니다. 도와주실 수 있는 분은 [다운로드 페이지 아래쪽의 안내](/ko/#store-distribution)를 봐 주세요.

## 모바일

Android에서는 `.apk`를 직접 설치합니다. 기기의 CPU에 맞는 것을 고르세요 (최근 기기는 거의 `arm64`). 출처를 알 수 없는 앱의 설치 허용을 요청받으면 허용하세요.

[Obtainium](https://obtainium.imranr.dev/)을 쓰면 GitHub Releases를 소스로 삼아 APK 업데이트를 자동으로 따라갈 수 있습니다. 아래 배지를 탭하면 미리 설정된 구성이 Obtainium으로 전달됩니다. 직접 추가하려면 Obtainium의 "앱 추가"에 저장소 URL `https://github.com/notedeck-dev/notedeck`를 붙여 넣으세요. 기기의 CPU에 맞는 APK는 자동으로 선택됩니다.

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

Google Play / App Store 배포는 아직 하지 않습니다. 스토어 배포에는 개발자 계정 등록비가 들고, Google Play의 경우 비공개 테스트 참가자가 필요하기 때문입니다. 도와주실 수 있는 분은 [다운로드 페이지 아래쪽의 안내](/ko/#store-distribution)를 봐 주세요.

## 업데이트

설치 프로그램 (`.exe` / `.dmg` / `.AppImage`)으로 설치한 데스크톱 버전은 실행할 때 새 버전을 확인하고 받아 옵니다. 받기가 끝나면 "업데이트 준비가 끝났습니다"라고 표시되며, 다시 시작하면 새 버전으로 바뀝니다.

패키지 관리자로 설치했다면 그쪽의 업데이트 절차를 따르세요 (`winget upgrade`, `yay -Syu` 등). `.deb` / `.tar.gz`도 마찬가지로 새 Release를 직접 다시 설치합니다.

Android 버전에는 자동 업데이트 기능이 없습니다. [Obtainium](#모바일)을 쓰면 GitHub Releases에 올라온 새 APK를 알림받고 설치할 수 있습니다.

## 제거한 후에도 데이터는 남습니다

앱을 삭제해도 설정 파일과 노트 캐시는 OS의 애플리케이션 데이터 영역에 남습니다. 완전히 지우려면 [설정 폴더](/ko/docs/config/files#설정은-어디에-있나)와 그 상위의 앱 데이터 폴더 (노트 캐시 `notecli.db`와 로그가 있습니다)를 삭제하세요. OS 키체인에 넣은 토큰은 별도로 남습니다.

[notemaid를 상주](/ko/docs/notemaid#상주시키기)시켰다면 먼저 토글을 끄면 (또는 `notemaid service uninstall`) 사라진 바이너리를 가리키는 로그인 시 작업이 남지 않습니다.

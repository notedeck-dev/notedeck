---
sourceHash: 8ff2c7d208fc
---

# 설치

OS별 설치 프로그램은 [GitHub Releases](https://github.com/notedeck-dev/notedeck/releases/latest)에서 배포합니다. 첫 페이지의 [다운로드](/ko/#download)에서도 바로 받을 수 있습니다.

| OS | 형식 |
|---|---|
| Windows | `.exe` (설치 프로그램) |
| macOS | `.dmg` (Universal — Intel / Apple Silicon 공통) |
| Linux | `.deb` / `.AppImage` |
| Android | `.apk` |

## 패키지 관리자

::: code-group

```powershell [winget (Windows)]
winget install NotedeckDev.NoteDeck
```

```bash [AUR (Arch Linux)]
yay -S misskey-notedeck-bin
```

```bash [Nix Flake]
# 앱 본체는 아직 Nix로 배포하지 않습니다 (AppImage나 tarball을 쓰세요).
# flake가 제공하는 것은 notemaid (AI 별도 프로세스)와 CLI입니다
nix profile add 'github:notedeck-dev/notedeck#notemaid'
nix profile add 'github:notedeck-dev/notedeck#notecli'
```

:::

## 처음 실행할 때의 경고

Windows / macOS 버전은 아직 코드 서명 없이 배포하고 있어, 처음 실행할 때 "알 수 없는 게시자" 경고가 표시됩니다.

- **Windows**: SmartScreen 화면에서 "추가 정보" → "실행"
- **macOS**: Finder에서 앱을 오른쪽 클릭 → "열기" → 다시 "열기" (시스템 설정 → "개인정보 보호 및 보안"에서 허용하는 방법도 있습니다)

서명이 없는 것은 비용과 심사의 문제이며, 악성 코드가 들어 있어서가 아닙니다. 배포물은 GitHub Actions가 공개 저장소의 소스에서 빌드하며, `SHA256SUMS.txt`로 해시를 검증할 수 있습니다.

경고를 없애려면 Windows는 OSS용 무료 코드 서명 ([SignPath Foundation](https://signpath.org/)) 심사를 통과해야 하고, macOS는 Apple Developer Program을 통한 공증 (notarization)이 필요합니다. SignPath Foundation은 "아무도 모르는 소스 코드에는 서명할 수 없다"며 실제로 쓰이고 있는 실적을 보기 때문에, [GitHub의 Star](https://github.com/notedeck-dev/notedeck)와 다운로드 수가 그대로 근거가 됩니다. 도와주실 수 있는 분은 [다운로드 페이지 아래쪽의 안내](/ko/#store-distribution)를 봐 주세요.

## 모바일

Android에서는 `.apk`를 직접 설치합니다. 출처를 알 수 없는 앱의 설치 허용을 요청받으면 허용하세요.

[Obtainium](https://obtainium.imranr.dev/)을 쓰면 GitHub Releases를 소스로 삼아 APK 업데이트를 자동으로 따라갈 수 있습니다. 아래 배지를 탭하면 미리 설정된 구성이 Obtainium으로 전달됩니다. 직접 추가하려면 Obtainium의 "앱 추가"에 저장소 URL `https://github.com/notedeck-dev/notedeck`를 붙여 넣으세요. 기기의 CPU에 맞는 APK는 자동으로 선택됩니다.

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.notedeck.desktop%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2Fnotedeck-dev%2Fnotedeck%22%2C%22author%22%3A%22notedeck-dev%22%2C%22name%22%3A%22NoteDeck%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Afalse%2C%5C%22versionDetection%5C%22%3Atrue%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5C%22%2C%5C%22autoApkFilterByArch%5C%22%3Atrue%2C%5C%22appName%5C%22%3A%5C%22NoteDeck%5C%22%2C%5C%22appAuthor%5C%22%3A%5C%22notedeck-dev%5C%22%7D%22%7D"><img src="/badge_obtainium.png" alt="Get it on Obtainium" height="48" /></a>

Google Play / App Store 배포는 아직 하지 않습니다. 스토어 배포에는 개발자 계정 등록비가 들고, Google Play의 경우 비공개 테스트 참가자가 필요하기 때문입니다. 도와주실 수 있는 분은 [다운로드 페이지 아래쪽의 안내](/ko/#store-distribution)를 봐 주세요.

## 업데이트

데스크톱 버전은 자동 업데이트를 지원합니다. 새 버전이 나오면 실행할 때 알려 주며, 그 자리에서 업데이트할 수 있습니다.

패키지 관리자로 설치했다면 그쪽의 업데이트 절차를 따르세요 (`winget upgrade`, `yay -Syu` 등).

Android 버전에는 자동 업데이트 기능이 없습니다. [Obtainium](#모바일)을 쓰면 GitHub Releases에 올라온 새 APK를 알림받고 설치할 수 있습니다.

## 제거한 후에도 데이터는 남습니다

앱을 삭제해도 설정 파일과 노트 캐시는 OS의 애플리케이션 데이터 영역에 남습니다. 완전히 지우려면 [설정 파일](/ko/docs/config/files#설정은-어디에-있나)의 폴더를 통째로 삭제하세요.

---
sourceHash: 24e5a61f3727
---

# 설정 파일

NoteDeck의 설정은 모두 파일로 손안에 있습니다. UI에서 바꿀 수 있는 것은 그대로 파일에도 쓰입니다. 외부 에디터로 직접 편집해도 괜찮습니다.

형식은 **JSON5**입니다. 주석을 쓸 수 있고, 끝의 쉼표도 허용됩니다.

예외로, 지금 열려 있는 프로파일, 위젯의 배치, 플러그인과 위젯이 `Mk:save`로 남긴 값은 파일이 아니라 앱 안의 저장 영역에 있습니다.

## 설정은 어디에 있나

**파일 → 설정 폴더 열기** (ファイル → 設定フォルダを開く)로 탐색기 / Finder가 열립니다. 이 방법이 가장 확실합니다.

경로를 알고 싶다면 OS의 애플리케이션 데이터 영역 아래에 있습니다.

| OS | 위치 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

한 단계 위의 `com.notedeck.desktop/`이 앱 데이터 폴더이며, 노트 캐시 `notecli.db`, 로그, AI 별도 프로세스가 앱에서 복사해 온 계정 목록 (`notemaid-accounts.json`)은 거기에 있습니다. 환경 변수 `NOTEDECK_APP_DIR`로 앱 데이터 폴더의 위치를 바꿀 수 있습니다.

같은 메뉴에서 로그 폴더, 다운로드 폴더, 백업 폴더도 열 수 있습니다.

## 무엇이 어디에 쓰이나

| 파일 | 내용 |
|---|---|
| `settings.json5` | 테마 선택, 모드, 뮤트, 캐시 설정 등 단순한 값을 모아 두는 곳 |
| `keybinds.json5` | [키 바인딩](/ko/docs/guide/keyboard) 덮어쓰기 |
| `navbar.json5` | [내비게이션 바](/ko/docs/deck/navbar)의 버튼 구성 |
| `performance.json5` | 렌더링 관련 조정값 |
| `postform.json5` | 글 입력란 설정 |
| `ai.json5` | [AI](/ko/docs/guide/ai)의 연결과 모델 선택, HEARTBEAT 설정 |
| `tasks.json5` | 작업 칼럼에서 실행하는 작업의 선언 |
| `permissions.json5` | 플러그인과 AI에게 허용하는 조작. 깨져 있으면 모든 행을 읽기만으로 두고 실행함 |
| `locale.json5` | 표시 언어 |
| `tutorial.json5` | 튜토리얼 달성 기록과 도전 과제 |
| `custom.css` | [외관 덮어쓰기](/ko/docs/guide/appearance#css로-세세하게-바꾸기) (이력은 `custom.css.history.json5`) |
| `theme-dropins.json5` | `themes/`에 직접 둔 테마의 가져오기 기록 |
| `client.json5` | 이 기기만의 구성 ([AI 별도 프로세스](/ko/docs/notemaid)의 연결 방식 등). 백업에는 들어가지 않음 |

폴더로 가지는 것도 있습니다.

| 폴더 | 내용 |
|---|---|
| `profiles/` | 덱의 프로파일 (`*.ndprofile.json5`) |
| `themes/` | 테마 (`*.ndtheme.json5`) |
| `plugins/` `widgets/` `queries/` | 코드 본체 `*.is`와 메타 정보 `*.meta.json5`의 짝 |
| `skills/` | 스킬 (`*.md`). `AGENTS.md`와 `HEARTBEAT.md`는 예약 |
| `snippets/` | 스크래치 패드의 스니펫 |
| `memos/` | 메모 (`*.md`) |
| `sessions/` | AI의 대화. 나만 읽을 수 있는 권한으로 저장됨 |
| `notemaid/` | AI의 인격과 기억 |

파일 이름은 표시 이름에서 만든 slug (스토어에서 왔다면 storeId)이며, 참조는 파일 안의 id로 합니다. 같은 id를 가진 파일이 중복되면 뒤의 것은 건너뛰고 토스트로 알려 줍니다.

`memos/`에는 Markdown 파일이 그대로 들어 있으므로, Obsidian의 vault로 열 수 있습니다.

`notemaid/`는 AI의 인격과 기억입니다. `SOUL.md` (인격) / `USER.md` (당신에 대해 기억하는 것) / `MEMORY.md` (비망록) 세 개의 Markdown과, 처음 한 번만 쓰이는 `BOOTSTRAP.md`가 있습니다. 외부 에디터로 직접 고쳐 써도 다음 대화부터 적용됩니다 (AI에게는 "NoteDeck 밖에서 변경되었다"고 전달됩니다). 에이전트 설정의 "페르소나" (ペルソナ), "메모리" (メモリー)에서도 읽고 쓸 수 있으며, `SOUL.md`의 본문만은 개발자 모드의 탭이나 외부 에디터에서 편집합니다. `skills/`의 `AGENTS.md` (규칙)와 `HEARTBEAT.md` (순회 절차)는 이름과 역할이 고정되어 있어, 지우거나 이름을 바꿀 수 없고 스킬 칼럼에도 나오지 않습니다 (에이전트 설정에서 편집합니다). 백업에 들어가는 것은 세 개의 Markdown뿐입니다.

::: tip API 키는 여기에 없습니다
액세스 토큰과 AI의 API 키는 OS 키체인에 들어 있습니다 (Linux에서 Secret Service가 없는 환경에서는 암호화 파일로 대피합니다). 설정 폴더를 그대로 누군가에게 건네도 키는 포함되지 않습니다.
:::

## 앱 안에서 편집하기

외부 에디터를 쓰지 않아도 설정 에디터 창에서 편집할 수 있습니다. [개발자 모드](/ko/docs/#개발자-모드)에서는 `settings.json5` 등을 날것 그대로 편집하는 탭도 나옵니다.

변경은 기본적으로 **재시작 없이 반영**됩니다. 외부 에디터로 고쳐 쓴 경우에도 다음에 쓰일 때 다시 읽힙니다.

## 잘못 썼을 때

JSON5로서 깨진 파일은 불러오기에 실패합니다. 그 경우 그 파일의 설정은 기본값으로 동작합니다 (`permissions.json5`만은 안전한 쪽으로 기울어, 모든 행이 읽기만으로 바뀝니다). 이상하다고 생각되면 해당 파일을 한 번 삭제하세요 (기본값으로 다시 만들어집니다).

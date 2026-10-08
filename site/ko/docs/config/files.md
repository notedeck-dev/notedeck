---
sourceHash: f6d58ea6d289
---

# 설정 파일

NoteDeck의 설정은 모두 파일로 손안에 있습니다. UI에서 바꿀 수 있는 것은 그대로 파일에도 쓰입니다. 외부 에디터로 직접 편집해도 괜찮습니다.

형식은 **JSON5**입니다. 주석을 쓸 수 있고, 끝의 쉼표도 허용됩니다.

## 설정은 어디에 있나

**파일 → 설정 폴더 열기** (ファイル → 設定フォルダを開く)로 탐색기 / Finder가 열립니다. 이 방법이 가장 확실합니다.

경로를 알고 싶다면 OS의 애플리케이션 데이터 영역 아래에 있습니다.

| OS | 위치 |
|---|---|
| Windows | `%APPDATA%\com.notedeck.desktop\notedeck\` |
| macOS | `~/Library/Application Support/com.notedeck.desktop/notedeck/` |
| Linux | `~/.local/share/com.notedeck.desktop/notedeck/` |

같은 메뉴에서 로그 폴더, 다운로드 폴더, 백업 폴더도 열 수 있습니다.

## 무엇이 어디에 쓰이나

| 파일 | 내용 |
|---|---|
| `settings.json5` | 테마 선택, 모드, 뮤트, 캐시 설정 등 단순한 값을 모아 두는 곳 |
| `keybinds.json5` | [키 바인딩](/ko/docs/guide/keyboard) 덮어쓰기 |
| `navbar.json5` | [내비게이션 바](/ko/docs/deck/navbar)의 버튼 구성 |
| `performance.json5` | 렌더링 관련 조정값 |
| `postform.json5` | 글 입력란 설정 |
| `ai.json5` | [AI](/ko/docs/guide/ai)의 연결과 모델 선택 |
| `AI.md` | AI에게 넘기는 지시서 |
| `tasks.json5` | 작업 칼럼의 내용 |
| `permissions.json5` | 플러그인과 AI에게 허용하는 조작 |
| `custom.css` | [외관 덮어쓰기](/ko/docs/guide/appearance#css로-세세하게-바꾸기) |

폴더로 가지는 것도 있습니다.

`profiles/` `themes/` `plugins/` `widgets/` `skills/` `queries/` `snippets/` `memos/` `sessions/` `notemaid/`

`memos/`에는 Markdown 파일이 그대로 들어 있으므로, Obsidian의 vault로 열 수 있습니다.

`notemaid/`는 AI의 인격과 기억입니다. `SOUL.md` (인격) / `USER.md` (당신에 대해 기억하는 것) / `MEMORY.md` (비망록) 세 개의 Markdown과, 처음 한 번만 쓰이는 `BOOTSTRAP.md`가 있습니다. 외부 에디터로 직접 고쳐 써도 다음 대화부터 적용됩니다 (AI에게는 "NoteDeck 밖에서 변경되었다"고 전달됩니다). `skills/`의 `AGENTS.md` (규칙)와 `HEARTBEAT.md` (순회 절차)는 이름과 역할이 고정되어 있어, 지우거나 이름을 바꿀 수 없습니다. 백업에 들어가는 것은 세 개의 Markdown뿐입니다.

::: tip API 키는 여기에 없습니다
액세스 토큰과 AI의 API 키는 OS 키체인에 들어 있습니다. 설정 폴더를 그대로 누군가에게 건네도 키는 포함되지 않습니다.
:::

## 앱 안에서 편집하기

외부 에디터를 쓰지 않아도 설정 에디터 창에서 편집할 수 있습니다. `settings.json5`는 Raw JSON 에디터에서 직접 만질 수도 있습니다.

변경은 기본적으로 **재시작 없이 반영**됩니다. 외부 에디터로 고쳐 쓴 경우에도 다음에 쓰일 때 다시 읽힙니다.

## 잘못 썼을 때

JSON5로서 깨진 파일은 불러오기에 실패합니다. 그 경우 그 파일의 설정은 기본값으로 동작합니다. 이상하다고 생각되면 해당 파일을 한 번 삭제하세요 (기본값으로 다시 만들어집니다).

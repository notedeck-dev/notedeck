---
sourceHash: 7949c17317a2
---

# 다른 앱에서 쓰기 (Raycast / Stream Deck / Obsidian)

데스크톱판 NoteDeck은 실행 중 내내 로컬 HTTP API(`127.0.0.1:19820`)를 열어 두고, 설치할 때 `notedeck://` 링크를 OS에 등록합니다. 이 두 입구를 쓰면 다른 앱에서 NoteDeck을 조작할 수 있습니다.

공식 연동은 3가지이며, 모두 NoteDeck 본체에는 아무것도 추가하지 않고 별도의 저장소에서 배포합니다. 같은 API로 직접 만들 수도 있습니다.

| 연동 | 어울리는 용도 | 저장소 |
|---|---|---|
| Raycast 확장 | 런처에서 게시·검색·칼럼 이동 | [notedeck-raycast](https://github.com/notedeck-dev/notedeck-raycast) |
| Stream Deck 플러그인 | 물리 키로 게시·칼럼 전환·보스 키 | [notedeck-streamdeck](https://github.com/notedeck-dev/notedeck-streamdeck) |
| Obsidian 플러그인 | 노트를 vault로 가져오기, Obsidian에서 게시, 사이드바 타임라인 | [notedeck-obsidian](https://github.com/notedeck-dev/notedeck-obsidian) |

::: warning 아직 스토어에는 올리지 않았습니다
3가지 모두 Raycast Store / Stream Deck Marketplace / Obsidian 커뮤니티 플러그인에 미등록입니다. 각 저장소 README의 절차대로 빌드해서 넣습니다. 실기기 확인도 충분하지 않으니, 동작하지 않으면 issue로 알려 주세요.
:::

## 공통 구조

3가지 연동은 같은 두 입구를 씁니다. 하나의 설정을 익히면 나머지도 같습니다.

**토큰이 필요한 조작** — NoteDeck의 API를 부르는 조작(게시, 검색, 계정 목록, 타임라인 가져오기 등)에는 영구 API 토큰이 필요합니다.

1. 설정 → 권한 → 「영구 API 토큰」에서 토큰을 발급해 연동의 설정에 붙여 넣습니다
2. 연동마다 별도의 토큰을 발급하고 이름(`raycast` `streamdeck` `obsidian` 등)을 붙여 두면, 확인 대화 상자와 조작 기록에 그 이름이 나와 어느 연동이 한 일인지 알 수 있습니다
3. 발급할 때 그 토큰으로 할 수 있는 조작을 고릅니다. 기본은 읽기만이며, 게시 같은 쓰기는 개별로 허용합니다. 상한은 같은 화면의 「외부 앱」 권한이고, 실제로 적용되는 것은 둘의 교집합입니다
4. 게시 같은 쓰기는 반드시 NoteDeck 화면에서 확인한 뒤 실행됩니다. 연동 쪽은 NoteDeck에서 답할 때까지 기다립니다

**토큰이 필요 없는 조작** — 게시 폼 열기, 프로파일 전환, 칼럼을 앞으로 가져오기 같은 화면 조작은 `notedeck://` 링크로 합니다. 토큰도 권한도 확인도 필요 없습니다. 링크를 여는 것은 본인이기 때문입니다. 링크로 할 수 있는 일은 [링크로 열기](/ko/docs/guide/links)에 있습니다.

::: tip 보안 경계가 아닙니다
토큰의 권한은 얌전한 연동의 사고를 막고 누가 무엇을 했는지 구분하기 위한 것입니다. 같은 OS 사용자로 동작하는 프로그램은 NoteDeck 본체와 같은 것에 닿을 수 있습니다. 자세한 내용은 [AI와 함께 쓰기](/ko/docs/guide/ai#외부-ai-에이전트에서-쓰기-mcp)의 같은 주의를 참고하세요.
:::

어느 연동이든 NoteDeck이 같은 기기에서 실행 중인 동안만 동작합니다. 개발판 NoteDeck(`pnpm tauri:dev`)은 API 포트가 다르므로 연동 쪽 설정에서 API URL을 바꿉니다.

## Raycast

Raycast(macOS / Windows)의 명령으로 NoteDeck을 부릅니다.

| 명령 | 하는 일 | 필요한 것 |
|---|---|---|
| Post Note | 본문·계정·공개 범위·CW를 넣어 게시합니다. ⌘O로 NoteDeck의 게시 폼에 넘길 수도 있습니다 | 토큰 + `notes.write` |
| Open Post Form | NoteDeck의 게시 폼을 본문이 들어간 상태로 엽니다 | 없음 |
| Search My Notes | 로컬에 쌓인 자신의 노트와 메모를 검색합니다. 비우면 최근 것. Enter로 NoteDeck 안에서 엽니다 | 토큰 + `notes.readArchive`와 `memos.read` |
| Jump to Column | 덱의 칼럼을 골라 앞으로 가져옵니다 | 토큰(읽기 기본값으로 충분) |
| Switch Deck Profile | [프로파일](/ko/docs/deck/profiles)을 이름으로 전환합니다 | 없음 |
| Ask AI | AI 칼럼을 프롬프트가 들어간 상태로 엽니다. 전송은 직접 누릅니다 | 없음 |
| New Memo | 로컬 메모를 하나 만듭니다 | 토큰 + `memos.write` |
| Hide NoteDeck / Show NoteDeck | 창을 숨기기 / 앞으로 되돌리기(보스 키) | 토큰(권한은 불필요) |
| Run Capability | NoteDeck의 모든 capability(명령 팔레트·플러그인·AI가 쓸 수 있는 것 전부)를 목록에서 골라 인자를 넣고 실행합니다. 결과는 JSON으로 보입니다 | 토큰 + 그 capability에 맞는 권한 |

Run Capability는 다른 연동에서 쓸 계정 id와 칼럼 id를 찾는 데에도 편리합니다.

## Stream Deck

Stream Deck의 키에 NoteDeck의 액션을 할당합니다. API URL과 토큰은 첫 키에서 한 번 넣으면 다른 키에도 공유됩니다.

| 액션 | 하는 일 | 필요한 것 |
|---|---|---|
| Post Note | 미리 정한 본문(계정·CW·공개 범위 포함)을 게시합니다 | 토큰 + `notes.write` |
| Open Post Form | NoteDeck의 게시 폼을 정해 둔 본문이 들어간 상태로 엽니다 | 없음 |
| Run Capability | capability의 id와 JSON 인자를 정해 두고 키로 실행합니다 | 토큰 + 그 capability에 맞는 권한 |
| Focus Column | 정해 둔 칼럼을 앞으로 가져옵니다 | 없음 |
| Switch Deck Profile | 정해 둔 프로파일로 전환합니다 | 없음 |
| Hide NoteDeck / Show NoteDeck | 창을 숨기기 / 앞으로 되돌리기(보스 키) | 토큰(권한은 불필요) |

성공하면 키에 ✓, 실패하면 ⚠가 나옵니다. 이유는 플러그인의 로그에 있습니다.

## Obsidian

Obsidian(데스크톱)에서 Misskey의 노트를 vault로 가져오고, Obsidian에서 게시하고, 사이드바에서 타임라인을 봅니다.

| 명령 / 화면 | 하는 일 | 필요한 것 |
|---|---|---|
| Clip a note by URL | 노트의 URL을 넣으면 그 노트를 Markdown(YAML frontmatter 포함)으로 vault에 씁니다 | 토큰(읽기 기본값으로 충분) |
| Search NoteDeck's archive and clip | 로컬에 쌓인 노트를 서버와 계정을 넘나들며 검색하고, Enter로 vault에 가져옵니다. Mod+Enter로 커서 위치에 링크를 넣습니다 | 토큰 + `notes.readArchive` |
| Post a note | 선택 범위를 본문으로 게시합니다(계정·공개 범위·CW 선택 가능) | 토큰 + `notes.write` |
| Open NoteDeck's post form with selection | 선택 범위를 NoteDeck의 게시 폼에 넘깁니다 | 없음 |
| 타임라인(사이드바) | 계정을 골라 home / local / social / global을 표시합니다. 새 노트는 NoteDeck의 이벤트 스트림에서 옵니다. 노트를 누르면 가져오기·NoteDeck에서 열기·서버에서 열기·링크 복사 | 토큰(읽기 기본값으로 충분) |

가져온 노트는 설정에서 정한 폴더(기본 `NoteDeck/`)에 「날짜 핸들 id.md」 이름으로 놓이며, 같은 노트를 다시 가져와도 덮어쓰지 않고 기존 파일을 엽니다. frontmatter에는 작성자·URL·일시·공개 범위·CW·인용 원본이 들어가고, 본문은 MFM 그대로, CW는 접히는 callout, 이미지는 임베드, 민감한 이미지와 그 밖의 파일은 링크가 됩니다.

::: tip 메모는 플러그인 없이 그대로 열 수 있습니다
NoteDeck의 [메모](/ko/docs/deck/columns)는 설정 폴더의 `memos/`에 Markdown 파일로 놓여 있습니다. 그 폴더를 Obsidian의 vault로 열면 플러그인 없이 읽고 쓸 수 있습니다. 이 플러그인은 메모를 건드리지 않습니다.
:::

Clip a note by URL이 받는 것은 NoteDeck에 로그인한 서버의 노트 URL뿐입니다(그 계정으로 노트를 가져오기 때문). 다른 서버의 노트는 검색에서 가져옵니다.

## 직접 만들기

3가지 연동이 하는 일은 `127.0.0.1:19820`에 Bearer 토큰을 붙여 HTTP를 보내는 것과 `notedeck://` 링크를 여는 것뿐입니다. 같은 일을 어느 언어에서든 할 수 있습니다.

- API 목록은 [개발자 모드](/ko/docs/#개발자-모드)의 「API 문서」 칼럼에서 볼 수 있습니다. capability는 `POST /api/capabilities/<id>/execute`로 부르고, `GET /api/capabilities`에 모든 capability와 그 인자·권한의 선언이 있습니다
- 새 노트와 알림을 바로 받으려면 `GET /api/events`의 Server-Sent Events를 구독합니다
- 호출하는 쪽이 AI 에이전트라면 같은 토큰으로 [MCP](/ko/docs/guide/ai#외부-ai-에이전트에서-쓰기-mcp)에 연결하는 편이 빠릅니다

연동을 만들었다면 issue로 알려 주세요. 이 페이지에 올리겠습니다.

---
sourceHash: 875f862cac13
---

# 링크로 열기 (notedeck://)

데스크톱 버전의 NoteDeck은 설치할 때 `notedeck://`라는 URL을 OS에 등록합니다. 브라우저, 런처, 메모 앱, 스크립트에서 이 URL을 열면 실행 중인 NoteDeck이 앞으로 나와 그 화면을 엽니다.

런처의 바로 가기, 매일 아침 여는 칼럼의 북마크, 외부 도구에서 글 입력란 불러오기 등에 쓸 수 있습니다.

## 전송은 확정되지 않습니다

`notedeck://`는 누구나 만들 수 있는 URL이며, 웹 페이지에 넣어 두고 클릭하게 만들 수도 있습니다. 그래서 링크로 게시하거나 AI에 전송하는 일은 일어나지 않습니다.

- 글 입력란과 AI 칼럼은 본문을 넣은 상태로 열기만 하며, 전송은 직접 누릅니다
- 스토어에서의 설치는 MisStore에 게재된 것만 설치됩니다
- 찾을 수 없는 프로파일, 칼럼, 스토어 아이템을 가리키는 링크는 아무것도 하지 않습니다

## 앱 전체에 대한 조작

계정을 고르지 않는 조작입니다. 값은 URL 인코딩합니다 (공백은 `%20`, 줄바꿈은 `%0A`).

| URL | 무슨 일이 일어나는가 |
|---|---|
| `notedeck://compose?text=<본문>&cw=<주석>&visibility=<공개 범위>` | 본문, 주석 (CW), 공개 범위를 넣은 상태로 글 입력란을 엽니다. 모두 생략할 수 있습니다. 공개 범위는 `public` `home` `followers` `specified` 중 하나 |
| `notedeck://ai?prompt=<문장>` | AI 칼럼을 열고 입력란에 문장을 넣습니다. AI 칼럼이 없으면 추가합니다 |
| `notedeck://memo/new?text=<본문>` | 본문이 담긴 메모를 하나 만듭니다 |
| `notedeck://profile/<이름>` | 덱의 [프로파일](/ko/docs/deck/profiles)을 전환합니다. 이름이 일치하지 않으면 id로 찾습니다 |
| `notedeck://column/<id>` | 그 칼럼을 활성화합니다 |
| `notedeck://install-plugin?id=<id>` | [MisStore](/ko/docs/guide/store)의 플러그인을 설치합니다 |
| `notedeck://install-theme?id=<id>` | MisStore의 테마를 설치합니다 |

칼럼의 id는 설정 폴더의 `profiles/`에 있는 프로파일 파일에 적혀 있습니다.

## 계정의 화면 열기

`notedeck://<서버>/...` 형태로 그 서버의 화면을 엽니다. `<서버>`는 `misskey.io` 같은 호스트 이름이며, 그 서버의 계정으로 로그인되어 있어야 합니다.

### 칼럼 추가하기

| URL | 추가되는 칼럼 |
|---|---|
| `notedeck://<서버>/timeline/<종류>` | 타임라인. 종류는 `home` `local` `social` `global` (생략하면 `home`) |
| `notedeck://<서버>/notifications` | 알림 |
| `notedeck://<서버>/search?q=<검색어>` | 서버 검색 |
| `notedeck://<서버>/antenna/<id>` | 안테나 |
| `notedeck://<서버>/channel/<id>` | 채널 |
| `notedeck://<서버>/favorites` | 즐겨찾기 |
| `notedeck://<서버>/mentions` | 멘션 |
| `notedeck://<서버>/direct` | 다이렉트 |
| `notedeck://<서버>/chat` | 채팅 |
| `notedeck://<서버>/announcements` | 공지사항 |
| `notedeck://<서버>/drive` | 드라이브 |
| `notedeck://<서버>/gallery` | 갤러리 |

### 창 열기

| URL | 열리는 창 |
|---|---|
| `notedeck://<서버>/note/<id>` | 노트 |
| `notedeck://<서버>/user/<id>` | 유저 |
| `notedeck://<서버>/user/<id>/following` | 팔로잉 목록 |
| `notedeck://<서버>/user/<id>/followers` | 팔로워 목록 |
| `notedeck://<서버>/list/<id>` | 리스트 |
| `notedeck://<서버>/clip/<id>` | 클립 |
| `notedeck://<서버>/gallery/<id>` | 갤러리 게시물 |
| `notedeck://<서버>/page/<id>` | 페이지 |
| `notedeck://<서버>/play/<id>` | Play |
| `notedeck://<서버>/instance/<호스트 이름>` | 연합한 서버의 정보 |

id는 그 서버의 내부 id입니다 (유저라면 `@name`이 아니라 Raw JSON 등에서 보이는 `id`).

## URL 알아내기

데스크톱 버전의 제목 표시줄에는 활성화된 칼럼이나 창의 URL이 표시됩니다. 자주 여는 화면은 거기서 URL을 옮겨 적어 북마크나 런처에 등록할 수 있습니다.

칼럼의 URL을 열면 같은 종류의 칼럼이 하나 더 추가됩니다. 덱에 있는 칼럼으로 이동하기만 하려면 `notedeck://column/<id>`를 씁니다.

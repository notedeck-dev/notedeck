---
sourceHash: cb4fd9250a85
---

# 플러그인

플러그인은 AiScript로 쓰는 확장입니다. 노트와 유저에 조작을 더하거나, 게시할 내용을 고쳐 쓰거나, 명령 팔레트에 명령을 추가할 수 있습니다. Misskey 본체의 플러그인과 같은 사고방식이지만, NoteDeck 고유의 API가 더해집니다.

## 최소 구성

맨 앞에 AiScript 버전과 메타 헤더를 씁니다. 버전 줄은 필수이며, 없으면 플러그인이 실행되지 않고 로그에 `version header required`라고 남습니다. 실행은 항상 새 쪽 인터프리터로 합니다.

```is
/// @ 1.2.1
### {
  name: "샘플"
  version: "1.0.0"
  author: "당신"
  description: "무엇을 하는 플러그인인지"
  permissions: []
}
```

메타에서 필수인 것은 `name`과 `version`만입니다. `config`를 쓰면 그 값을 `Plugin:config`로 읽을 수 있습니다.

## 등록할 수 있는 훅

`Plugin:register_*`로 훅을 등록합니다. 플러그인은 불러올 때 한 번 실행되며, 거기서 등록한 함수가 나중에 이벤트마다 호출됩니다.

| 훅 | 호출되는 때 |
|---|---|
| `register_note_action` | 노트 메뉴에서 선택되었을 때 |
| `register_user_action` | 유저 메뉴에서 선택되었을 때 |
| `register_post_form_action` | 글 입력란의 버튼이 눌렸을 때 |
| `register_note_view_interruptor` | 노트를 표시하기 직전 |
| `register_note_post_interruptor` | 노트를 게시하기 직전 |
| `register_page_view_interruptor` | 페이지를 표시하기 직전 |

명령 팔레트의 명령은 훅이 아니라 뒤에서 설명할 `Nd:register_command`로 더합니다.

::: warning interruptor는 동기 실행
`*_interruptor`는 동기적으로 호출되므로, 안에서 확인 대화 상자를 띄울 수 없습니다. 게시를 막는 용도라면 확인을 거치지 않고 자동으로 처리하는 방식 (CW를 자동으로 붙이기, 공개 범위 낮추기)으로 합니다.
:::

## NoteDeck 고유 API

| API | 무엇을 하는가 |
|---|---|
| `Nd:version` | 앱 버전 |
| `Nd:call(id, params)` | capability를 호출합니다. 권한 범위 안에서만 성공합니다. 확인 대화 상자가 취소되면 오류가 되지 않고, `Core:type`이 `"error"`인 값이 돌아옵니다 |
| `Nd:capabilities()` | 호출할 수 있는 capability 목록 |
| `Nd:http(url, options)` | 외부로의 HTTP 요청. `{ status, headers, body }`가 돌아옵니다. 통신 두절(이름 풀이 실패・연결 거부・타임아웃)도 오류가 되지 않고, `status`가 `0`이며 `error`에 이유가 들어갑니다 |
| `Nd:on(event, handler)` | 앱 안의 이벤트를 구독합니다 |
| `Nd:register_command(...)` | 명령 팔레트에 명령을 더합니다 |
| `Plugin:open_url(url)` | URL을 기본 브라우저로 엽니다 |

`Nd:on`으로 구독할 수 있는 이벤트는 노트 도착, 알림 도착, 칼럼 추가와 삭제, 스트리밍 연결 상태, 메모 생성·수정·삭제, 스킬 편집, 테마 적용입니다.

`Nd:register_command`로 더한 명령은 명령 팔레트, 키 바인딩, AI의 도구, 로컬 API 어디에서든 호출할 수 있습니다. AI나 로컬 API에서 호출되었을 때의 실효 권한은 "호출한 쪽의 권한 ∩ 플러그인의 권한"입니다.

## Misskey 호환 API

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize`를 쓸 수 있습니다. Misskey 본체의 플러그인을 그대로 가져올 때는 이 범위 안에서 쓰여 있는지 확인하세요. `Mk:save`의 값은 파일이 아니라 앱 안의 저장 영역에 들어가며, [백업](/ko/docs/config/backup)에는 포함되지 않습니다.

## 권한

플러그인이 할 수 있는 일은 [권한 설정](/ko/docs/guide/ai#권한)의 "플러그인" (プラグイン) 행에서 정해집니다. 기본값은 읽기 위주의 안전한 범위와 외부 통신이며, 게시 등의 쓰기는 하나씩 허용합니다. `Nd:call` / `Nd:http` / `Mk:api`는 모두 이 설정으로 판정되며, 거부된 조작은 플러그인 칼럼에 거부 배지로 나타납니다. 스킬 쓰기나 AI에 대한 지시에 해당하는 조작은 설정과 관계없이 항상 거부됩니다.

메타 헤더의 `permissions`는 스토어에서 업데이트했을 때 "새로 요구하는 권한"을 보여 주고 다시 동의를 받기 위한 선언입니다.

## 저장 위치

설정 폴더의 `plugins/`에 코드 본체 `<slug>.is`와 메타 정보 `<slug>.meta.json5` 두 파일로 저장됩니다. 목록은 메타 파일에서 만들어지므로 `.is`만 두면 읽히지 않습니다. 직접 둘 때는 개발자 모드의 에디터에서 새로 만든 뒤 내용을 바꿔 넣는 것이 확실합니다. 파일 이름은 표시 이름에서 만든 slug (스토어에서 왔다면 storeId)이며, 참조는 파일 안의 id로 합니다. 같은 id가 중복되면 뒤의 것은 건너뛰고 토스트로 알려 줍니다.

## 만들기와 배포하기

AI 칼럼에서 "○○하는 플러그인을 만들어 줘"라고 부탁하는 것이 가장 빠릅니다 (먼저 MisStore의 작성자 스킬을 설치해 둡니다). 작성과 편집의 입구는 [개발자 모드](/ko/docs/#개발자-모드)에서 열립니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)).

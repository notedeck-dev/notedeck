---
sourceHash: 351a0242008d
---

# 플러그인

플러그인은 AiScript로 쓰는 확장입니다. 노트와 유저에 조작을 더하거나, 게시할 내용을 고쳐 쓰거나, 명령 팔레트에 명령을 추가할 수 있습니다. Misskey 본체의 플러그인과 같은 사고방식이지만, NoteDeck 고유의 API가 더해집니다.

## 최소 구성

맨 앞에 메타 헤더를 씁니다. AiScript 버전 지정을 빼면 옛 파서로 해석되어, 뒤에서 설명할 interruptor를 쓸 수 없습니다.

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
| `register_command` | 명령으로 호출되었을 때 |

::: warning interruptor는 동기 실행
`*_interruptor`는 동기적으로 호출되므로, 안에서 확인 대화 상자를 띄울 수 없습니다. 게시를 막는 용도라면 확인을 거치지 않고 자동으로 처리하는 방식 (CW를 자동으로 붙이기, 공개 범위 낮추기)으로 합니다.
:::

## NoteDeck 고유 API

| API | 무엇을 하는가 |
|---|---|
| `Nd:version` | 앱 버전 |
| `Nd:call(id, params)` | capability를 호출합니다. 권한 범위 안에서만 성공합니다. 확인 대화 상자가 취소되면 오류가 되지 않고, `Core:type`이 `"error"`인 값이 돌아옵니다 |
| `Nd:capabilities()` | 호출할 수 있는 capability 목록 |
| `Nd:http(url, options)` | 외부로의 HTTP 요청 |
| `Nd:on(event, handler)` | 앱 안의 이벤트를 구독합니다 |
| `Nd:register_command(...)` | 명령 팔레트에 명령을 더합니다 |

`Nd:on`으로 구독할 수 있는 이벤트에는 노트 도착, 알림 도착, 계정 전환, 칼럼 추가와 삭제, 스트리밍 연결 상태, 메모 생성·수정·삭제, 스킬 편집, 테마 적용이 있습니다.

## Misskey 호환 API

`Mk:api` `Mk:dialog` `Mk:confirm` `Mk:toast` `Mk:save` `Mk:load` `Mk:remove` `Mk:url` `Mk:nyaize`를 쓸 수 있습니다. Misskey 본체의 플러그인을 그대로 가져올 때는 이 범위 안에서 쓰여 있는지 확인하세요.

## 권한

외부 통신이나 노트 게시 등 영향이 있는 조작에는 권한이 필요합니다. 메타 헤더의 `permissions`에 선언하고, 설치할 때 사용자가 승인합니다. 선언하지 않은 조작은 실행할 때 거부됩니다.

## 만들기와 배포하기

AI 칼럼에서 "○○하는 플러그인을 만들어 줘"라고 부탁하는 것이 가장 빠릅니다. 직접 쓴다면 설정 폴더에 둡니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#プラグイン)).

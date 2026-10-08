---
sourceHash: 0be06c29295f
---

# 칼럼 쿼리

칼럼 쿼리는 칼럼에 흘러오는 노트를 걸러 내기 위한 식입니다. AiScript의 부분 집합으로 쓰며, **true를 반환한 노트가 표시됩니다**. "○○ 숨기기"를 쓸 때는 조건을 쓴 다음 전체를 `!(...)`로 감쌉니다.

```is
/// @ 1.2.1
// 특정 키워드를 포함한 노트를 숨기기 — true = 표시
!(note.text != null && note.text.lower().incl("스포일러"))
```

칼럼 설정의 필터에서 편집하고 저장합니다. 여러 쿼리는 And로 합성되므로, 쿼리 하나에는 기능 하나만 맡기는 편이 다루기 쉽습니다.

## 참조할 수 있는 것

식 안에서 자유롭게 참조할 수 있는 것은 `note`뿐입니다. 다음 필드는 빠르게 평가되며, 로컬에 쌓인 노트 검색에도 쓸 수 있습니다.

```
note.text  note.cw  note.visibility  note.localOnly
note.renoteId  note.replyId
note.user.username  note.user.host  note.user.name
note.files.len  note.reactions["이모지_이름"]
```

비교와 논리 연산, 문자열의 `incl` / `starts_with` / `ends_with` / `lower` / `upper`, 배열의 `incl` / `len`, `let`, 재귀하지 않는 순수 함수를 쓸 수 있습니다.

이 범위를 벗어나는 필드 (`note.user.isCat`, `note.channelId`, `note.renote.text`, `note.poll` 등)도 동작하지만, 한 건씩 평가하는 느린 경로로 떨어집니다. 결과는 같고 속도만 다릅니다.

## 쓸 때의 주의점

- **null은 `&&`의 단락 평가로 피합니다** — `note.text` / `note.cw` / `note.user.name`은 null일 수 있습니다. `note.text != null && note.text.incl("x")` 형태로 씁니다. `let`은 먼저 평가되므로 가드가 되지 않습니다
- **이항 연산자 뒤에서 줄을 바꾸지 않습니다** — 식은 한 줄에 담거나 함수로 분리합니다
- **외부와 통신할 수 없습니다** — `Mk:api`나 현재 시각 가져오기, 비동기 처리는 저장할 때 거부됩니다
- **해시태그 전용 필드는 없습니다** — 본문의 문자열 일치로 대신합니다. 앞부분 일치로 의도하지 않은 태그에도 걸릴 수 있다는 점에 주의하세요
- **칼럼 설정에 이미 있는 것은 만들지 않습니다** — 리노트 제외, 답글 제외, 미디어만, bot 제외는 토글로 준비되어 있습니다

## 설치하기와 배포하기

[스토어](/ko/docs/guide/store)에서 설치한 쿼리를 그대로 쓸 수도, 편집해서 자기에게 맞게 고칠 수도 있습니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#クエリ)).

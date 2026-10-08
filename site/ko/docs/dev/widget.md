---
sourceHash: 6d4fe29094a3
---

# 위젯

위젯은 작은 UI를 화면에 두기 위한 확장입니다. AiScript로 쓰며, 시계나 집계, 외부에서 가져온 데이터 표시 등에 씁니다. 플러그인과 달리 훅이 없고, 실행하면 그리기만 하는 단순한 구조입니다.

## 최소 구성

최상위에서 `Ui:render`를 호출합니다. 메타 헤더는 플러그인과 달리 필수가 아니지만, 써 두면 관리하기 쉬워집니다.

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

UI는 `Ui:C:*` 컴포넌트를 나열해서 조립합니다. 텍스트, 버튼, 입력란 등을 쓸 수 있습니다.

## 상태 갖기

`Mk:save`와 `Mk:load`로 위젯별 영역에 값을 남길 수 있습니다. 다시 그리기나 앱 재시작을 거쳐도 유지됩니다.

```is
/// @ 1.2.1
var count = (Mk:load("count") or 0)

Ui:render([
  Ui:C:text({ text: `Count: {count}` })
  Ui:C:button({
    text: "+1"
    onClick: @() {
      count += 1
      Mk:save("count", count)
    }
  })
])
```

## 자동 실행

위젯은 기본적으로 수동 실행입니다. 칼럼을 열어도 멋대로 돌지 않고, "실행" (起動)을 눌렀을 때 실행됩니다. 자동 실행으로 바꿀 수도 있지만, 외부와 통신하는 위젯은 열기만 해도 통신이 일어난다는 점에 주의하세요. 전환은 언제든 되돌릴 수 있습니다.

## 만들기와 배포하기

AI 칼럼에서 "○○를 표시하는 위젯을 만들어 줘"라고 부탁할 수 있습니다. 직접 쓴다면 설정 폴더에 코드 본체와 메타 정보, 두 파일을 둡니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)).

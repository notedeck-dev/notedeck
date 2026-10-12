---
sourceHash: c6c7b7b84e50
---

# 위젯

위젯은 작은 UI를 화면에 두기 위한 확장입니다. AiScript로 쓰며, 시계나 집계, 외부에서 가져온 데이터 표시 등에 씁니다. 플러그인과 달리 훅이 없고, 실행하면 그리기만 하는 단순한 구조입니다.

## 최소 구성

최상위에서 `Ui:render`를 호출합니다. 플러그인 같은 메타 헤더는 해석되지 않습니다. 이름이나 자동 실행 설정은 옆에 두는 메타 파일 (뒤에서 설명)이 갖습니다.

```is
/// @ 1.2.1
Ui:render([
  Ui:C:text({ text: "Hello, world" })
])
```

UI는 `Ui:C:*` 컴포넌트를 나열해서 조립합니다. 텍스트, 버튼, 입력란 등을 쓸 수 있습니다.

## 상태 갖기

`Mk:save`와 `Mk:load`로 값을 남길 수 있습니다. 다시 그리기나 앱 재시작을 거쳐도 유지됩니다. 저장 영역은 "위젯 × 실행하는 계정"마다 나뉘므로, 같은 위젯을 계정을 바꿔 두어도 값이 섞이지 않습니다. 이 값은 파일이 아니라 앱 안의 저장 영역에 있으며, [백업](/ko/docs/config/backup)에는 포함되지 않습니다.

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

위젯은 기본적으로 수동 실행입니다. 칼럼을 열어도 멋대로 돌지 않고, "실행" (実行)을 눌렀을 때 실행됩니다. "자동 실행" (自動実行)을 켤 수도 있지만, 외부와 통신하는 위젯은 열기만 해도 통신이 일어난다는 점에 주의하세요. 전환은 언제든 되돌릴 수 있습니다.

어느 계정으로 실행할지는 위젯 칼럼에 두었을 때의 배치가 갖습니다. 위젯이 할 수 있는 일의 범위는 [권한 설정](/ko/docs/guide/ai#권한)의 "플러그인" (プラグイン) 행과 같은 규칙으로 정해집니다.

## 저장 위치

설정 폴더의 `widgets/`에 코드 본체 `<slug>.is`와 메타 정보 `<slug>.meta.json5` (이름, 자동 실행, 모든 계정용인지, 어느 계정에 넣었는지, 작성·수정 일시) 두 파일로 저장됩니다. 목록은 메타 파일에서 만들어집니다.

## 만들기와 배포하기

AI 칼럼에서 "○○를 표시하는 위젯을 만들어 줘"라고 부탁할 수 있습니다 (먼저 MisStore의 작성자 스킬을 설치해 둡니다). 작성과 편집의 입구는 [개발자 모드](/ko/docs/#개발자-모드)에서 열립니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#ウィジェット)).

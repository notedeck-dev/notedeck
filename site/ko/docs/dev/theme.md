---
sourceHash: d9dad1fc2339
---

# 테마

테마는 색 구성의 정의입니다. Misskey 본체와 같은 형식이므로, NoteDeck에서 만든 테마는 일반 Misskey에도 그대로 배포할 수 있습니다.

색 구성이 아니라 레이아웃이나 요소의 표시·숨기기를 바꾸고 싶다면 [외관 바꾸기](/ko/docs/guide/appearance)의 커스텀 CSS를 씁니다.

## 구조

JSON5로 씁니다. 키의 따옴표 생략, 끝의 쉼표, 주석을 쓸 수 있습니다.

```json5
{
  id: '679b3b87-a4e9-4789-8696-b56c15cc33b0',  // 덮어쓰기의 키. UUID가 관례. 없으면 자동으로 부여됨
  name: '테마 이름',                             // 없으면 'Untitled'
  base: 'dark',                                 // 'light' 또는 'dark'
  desc: '짧은 설명',                             // 선택
  author: '@user@host',                         // 선택
  props: { /* 색 정의 */ },                      // 필수
}
```

`props`에 쓰지 않은 키는 `base`에 지정한 표준 테마의 값이 쓰입니다. 전부 쓸 필요는 없으며, 바꾸고 싶은 곳만 쓰면 동작합니다.

`id`는 덮어쓰기의 키입니다. 붙여 넣기나 코드에서 같은 `id`로 다시 설치하면 기존 테마가 교체되므로, 새 테마에는 반드시 새 `id`를 붙이세요.

NoteDeck에서만 쓰는 정보 (스토어의 id 등)는 `$notedeck` 아래에 들어갑니다. 일반 Misskey는 이 키를 무시합니다.

## 값 쓰는 법

**리터럴 색** — `'#f00'` `'#ff0000'` `'#ff000080'` (8자리는 알파 포함) `'rgb(255, 0, 0)'` `'rgba(255, 0, 0, 0.5)'` 외에 `hsl()` / `hsla()` / `oklch()`와 공백으로 구분하는 `rgb(r g b / a)`도 해석됩니다.

**참조** — `'@accent'`처럼 같은 테마의 다른 값을 씁니다. 참조한 곳이 다시 참조나 함수여도 해석됩니다. 존재하지 않는 이름을 참조하면 빈 값이 되어 그 색이 사라집니다. 오타에 주의하세요.

**상수** — `props` 안에 `$이름: '#...'`으로 쓴 값은 `'$이름'`으로 참조할 수 있는 상수가 됩니다. CSS 변수로는 나오지 않습니다 (본가와 같음).

**함수** — `:함수<인수<값` 형태로 색을 가공합니다. 닫는 괄호는 쓰지 않습니다.

| 함수 | 효과 |
|---|---|
| `:lighten<10<@accent` | 밝게 합니다 |
| `:darken<10<@accent` | 어둡게 합니다 |
| `:alpha<0.3<@accent` | 불투명도를 바꿔 넣습니다 (곱하기가 아님) |
| `:hue<20<@accent` | 색상을 회전합니다 |
| `:saturate<15<@accent` | 채도를 올립니다 (음수면 내립니다) |

`':alpha<0.5<:lighten<10<@accent'`처럼 중첩할 수 있습니다. 여기에 없는 함수 이름은 해석되지 않고 문자열이 그대로 나와 깨져 보입니다. 함수의 입력으로 `red` 같은 색 이름은 쓸 수 없습니다.

**원시 CSS** — 맨 앞에 `"`를 하나 두면 그 뒤가 그대로 CSS 값이 됩니다. 닫지 않습니다. 다른 값은 `var(--MI_THEME-속성이름)`으로 참조할 수 있습니다.

```json5
panelBorder: '" solid 1px var(--MI_THEME-divider)',
```

## NoteDeck에서만 효과가 있는 prop

`accentDarken` (액센트의 진한 버전)과 `accentText` (액센트 위에 놓는 글자색)는 쓰지 않으면 `accent`에서 자동으로 만들어집니다. 일반 Misskey에는 없는 prop이므로 그쪽에서는 효과가 없습니다.

## 저장 위치

설정 폴더의 `themes/`에 `<slug>.ndtheme.json5`로 저장됩니다. 직접 둘 때는 일반 `.json5` (Misskey에서 복사한 테마 등)를 이 폴더에 두기만 해도 가져오지만, 그것은 **한 번뿐인 복사**이며 원본 파일을 나중에 편집해도 반영되지 않습니다. 가져온 뒤에는 새 id가 붙고, 원래의 `id`는 쓰이지 않습니다.

## 만들기와 배포하기

AI 칼럼에서 "○○ 느낌의 테마를 만들어 줘"라고 부탁할 수 있습니다 (먼저 MisStore의 작성자 스킬을 설치하고, [권한](/ko/docs/guide/ai#권한)에서 테마 쓰기를 허용해 둡니다. 기본값은 꺼져 있습니다). 작성과 편집의 입구는 [개발자 모드](/ko/docs/#개발자-모드)에서 열립니다. 만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md#テーマ)).

---
sourceHash: e642e3e818c4
---

# 확장 만들기

NoteDeck은 들어 있는 기능을 쓰는 데 그치지 않고, 직접 기능을 더할 수 있습니다. 더할 수 있는 것은 5종류이며, 각각 역할과 쓰는 언어가 다릅니다.

| 종류 | 무엇을 하는가 | 쓰는 것 |
|---|---|---|
| [플러그인](/ko/docs/dev/plugin) | 노트와 유저에 대한 조작을 더합니다. 게시물 고쳐 쓰기, 명령 추가 | AiScript |
| [위젯](/ko/docs/dev/widget) | 작은 UI를 둡니다. 시계, 집계, 외부 데이터 표시 | AiScript |
| [테마](/ko/docs/dev/theme) | 색 구성을 바꿉니다 | JSON5 |
| [칼럼 쿼리](/ko/docs/dev/query) | 칼럼에 흘러오는 노트를 걸러 내고 정렬합니다 | AiScript의 부분 집합 |
| [스킬](/ko/docs/dev/skill) | AI의 행동을 정합니다 | Markdown |

헷갈릴 때는 "무엇을 바꾸고 싶은가"로 고릅니다. **외관**이라면 테마, **흘러오는 것**이라면 칼럼 쿼리, **조작**이라면 플러그인, **화면에 둘 것**이라면 위젯, **AI의 응답**이라면 스킬입니다.

## 세 가지 만드는 방법

**AI에게 만들게 하기** — 가장 빠른 방법입니다. AI 칼럼에서 "○○하는 플러그인을 만들어 줘"라고 부탁하면, 작성자 스킬 (MisStore에서 배포)이 실행되어 AiScript를 쓰고, 검증한 뒤 저장합니다. 쓰는 법을 몰라도 동작하는 것을 얻을 수 있습니다.

**직접 쓰기** — "파일 → 설정 폴더 열기" (ファイル → 設定フォルダを開く)로 설정 폴더를 열고 텍스트 에디터로 직접 쓸 수 있습니다. 앱 안의 에디터에서도 편집할 수 있습니다.

**스토어에서 설치해서 고치기** — [스토어](/ko/docs/guide/store)에서 설치한 것은 그대로 편집할 수 있습니다. 동작하는 것을 출발점으로 삼는 편이 처음부터 쓰는 것보다 확실합니다.

## 어디에 놓이는가

확장은 모두 설정 폴더 안의 파일입니다. 계정 정보와는 따로 저장되며, [백업](/ko/docs/config/backup) 대상이 됩니다. 파일 위치와 역할은 [설정 파일](/ko/docs/config/files)을 참고하세요.

## 배포하기

만든 것은 [MisStore](https://store.notedeck.io)에서 배포할 수 있습니다. 제출 절차와 큐레이션 기준은 MisStore 쪽 문서 ([제출 방법](https://github.com/notedeck-dev/misstore/blob/main/CONTRIBUTING.md) / [형식 레퍼런스](https://github.com/notedeck-dev/misstore/blob/main/docs/registry-format.md))를 참고하세요. 테마는 NoteDeck 고유의 형식이 아니므로, 일반 Misskey에도 그대로 배포할 수 있습니다.

---
sourceHash: 0af060a8bcf3
---

# AI 별도 프로세스 (notemaid)

NoteDeck의 AI (에이전트 루프와 HEARTBEAT)는 앱과는 별도의 프로세스인 **notemaid**에서 동작합니다. 타임라인 가져오기, 저장, 구독, 덱은 앱 안에서 동작하고, notemaid는 AI만 맡습니다. 평소에는 신경 쓸 필요가 없습니다. 앱이 실행될 때 함께 들어 있는 notemaid를 자식 프로세스로 띄우고, 앱이 종료될 때 함께 종료됩니다.

## 두 가지 실행 방식

| 형태 | 누가 실행하는가 | 무엇을 할 수 있는가 |
|---|---|---|
| 기본 (자식 프로세스) | 앱 | 설정이 필요 없습니다. 앱과 함께 시작하고 함께 끝납니다. 창을 닫아 트레이에 남겨 두면 AI도 살아 있습니다 |
| 상주 | OS의 로그인 시 작업 (AI 설정의 토글) | 앱을 완전히 종료해도 HEARTBEAT가 계속됩니다. 다음에 앱을 열면 자동으로 그쪽에 연결됩니다 |

두 방식 모두 같은 기기 위에서 동작합니다. 다른 기기나 자신의 서버에서 동작하는 notemaid에 연결하는 방식은 제공하지 않습니다 (얻는 것은 순회의 지속뿐으로 상주 방식과 같은 반면, 인증과 키 보관의 번거로움이 크기 때문입니다).

앱은 실행할 때 먼저 상주하는 notemaid가 있는지 보고, 있으면 연결하고 없으면 자식 프로세스를 실행합니다. 어느 방식이든 데이터 (저장, 구독, 덱)는 기기 위에 있으며, notemaid는 앱의 설정과 OS 키체인에 있는 같은 계정의 토큰을 씁니다 (앱의 데이터베이스는 열지 않습니다). 버전은 앱과 일치해야 합니다 (다르면 AI 설정에 이유가 표시됩니다).

## 상주시키기

앱을 완전히 닫아도 HEARTBEAT를 돌리고 싶을 때만 설정합니다. 설정 메뉴의 **AI 설정** → HEARTBEAT에 있는 "앱을 종료해도 계속" (アプリを終了しても続ける)을 켜면, OS의 로그인 시 작업 (Linux는 systemd user unit, macOS는 LaunchAgent, Windows는 사용자별 Run 키 (로그인 시 자동 실행))으로 등록되고 그 자리에서 전환됩니다 (재시작 불필요). 다시 끄면 등록을 해제하고 자식 프로세스로 돌아갑니다.

AppImage는 실행할 때마다 마운트 위치가 바뀌므로 토글을 쓸 수 없습니다. Releases의 standalone 바이너리를 PATH가 잡힌 곳에 두고 직접 등록합니다.

```bash
notemaid service install    # 로그인 시 작업을 준비
notemaid service enable     # 등록하고 실행
```

Linux에서 로그아웃 후에도 계속 동작시키려면 `loginctl enable-linger`를 설정합니다. 멈출 때는 `notemaid service stop`, 필요 없으면 `uninstall`입니다.

상주하는 쪽에만 연결하고 싶을 때 (자식 프로세스를 실행하지 않게 하려면) 설정 폴더의 `client.json5`를 `{ backend: "resident" }`로 합니다. 반대로 항상 in-process로 돌리고 싶을 때 (개발이나 문제 분리)는 `{ backend: "embedded" }`입니다. 기본값은 `auto`입니다.

## 전제 조건

- Linux에서 상주시키려면 systemd **user 세션**이 동작하고 있어야 합니다 (`systemctl --user status`가 통해야 합니다). WSL2에서는 `/etc/wsl.conf`에서 systemd를 활성화합니다
- 상주용 socket을 둘 곳으로 `XDG_RUNTIME_DIR`가 필요합니다. 자식 프로세스는 없어도 동작합니다 (임시 디렉터리를 씁니다)

## 문제가 생겼을 때

- **로그**: 자식 프로세스와 macOS / Windows의 상주 방식은 데이터 디렉터리의 `logs/notemaid.log`, Linux의 상주 방식은 `journalctl --user -u notemaid -e`
- **버전이 다름**: notemaid를 앱과 같은 버전으로 업데이트하세요. 자식 프로세스는 앱에 함께 들어 있으므로 항상 같은 버전입니다
- **notemaid가 스스로 멈춤**: 재시작해도 고쳐지지 않는 상태 (다른 notemaid가 같은 데이터 디렉터리에서 동작 중, secret 키를 읽을 수 없음)에서는 전용 종료 코드로 멈추며, systemd는 재시작하지 않습니다. 이유는 로그에 남습니다

## notemaid가 소유하는 것

notemaid가 쓰는 것은 설정 폴더 안의 자기 소유물뿐입니다: AI의 인격과 기억 (`notemaid/`), AI 세션 (`sessions/`), 메모 (`memos/`), 스킬 (`skills/`), AI 설정 (`ai.json5`). 앱의 데이터베이스는 열지 않습니다. 인격과 기억의 내용은 AI 설정의 "AI의 인격과 기억" (AI の人格と記憶)에서 읽고 쓸 수 있으며, 파일 목록은 [설정 파일](/ko/docs/config/files)에 있습니다.

## 명령

```bash
notemaid run                 # 포그라운드에서 실행
notemaid status              # 동작 중인 notemaid의 상태
notemaid service install     # 로그인 시 작업을 준비 (start는 하지 않음)
notemaid service enable      # 등록하고 실행
notemaid service status | stop | restart | uninstall
```

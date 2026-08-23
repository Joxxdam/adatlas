# 자동 제작 운영 가이드

`/admin/auto-production`은 수동 제작과 같은 상품 분석, ProductTruth, 호환 ZIP 레퍼런스 선배정, 레퍼런스 적응 문구 배치, 원본 무손실 복사, 단계형 상품·문구 교체, QA와 소재코드 저장 흐름을 재사용하는 내부 운영 기능입니다. 광고 플랫폼 등록이나 집행은 자동으로 수행하지 않습니다.

## 기본 운영값

- 시간대: Asia/Seoul
- 실행 시각: 매일 00:00(한국시간, 날짜가 바뀌는 자정)
- 초기 예시 광고주: 국대한우, 대한한우, 힘내라농가(런타임 설정이 없을 때 모두 일시정지)
- 광고주별 상품: 최대 4개
- 상품별 실행: 중복 없는 상품군별 ZIP 레퍼런스 6장을 먼저 고정하고 레퍼런스별 문구 6개를 한 번에 준비
- 생성 흐름: 수동 제작과 동일한 레퍼런스 원본 무손실 복사 → URL 상품 교체 → ProductTruth 문구 교체 → QA → 저장
- 기본 일일 상한: 72장(광고주 3곳 × 상품 4개 × 광고 6장)
- 광고주 run 동시성: 설정값 기준 최대 2, 동일 광고주는 직렬 처리. 이미지 생성 전역 동시성은 최대 3
- 상품 쿨다운과 실행 키로 중복 상품 작업 방지

BigQuery 또는 크리마 데이터가 없으면 같은 광고주의 공개 사이트 분석으로 전환하며, 그래도 후보가 없을 때만 광고주 설정의 관리자 상품 URL을 사용합니다. 확인할 수 없는 판매량·매출·전환·ROAS는 만들지 않습니다.

## 환경 변수

`.env.local`에 필요한 생성 엔진 설정과 아래 선택 항목을 둡니다.

```env
ADATLAS_AUTO_PRODUCTION_TOKEN=
ADATLAS_AUTO_PRODUCTION_BASE_URL=http://127.0.0.1:3000
ADATLAS_AUTO_PRODUCTION_STALE_MS=720000
```

토큰은 외부 서버나 별도 OS 예약 작업에서 API를 호출할 때만 필요합니다. 로컬 브라우저의 동일 출처 요청에는 노출하지 않습니다. `NEXT_PUBLIC_*` 변수로 만들면 안 됩니다.

## 수동 점검과 실행

먼저 AdAtlas 서버가 실행 중이어야 합니다.

```bash
npm run dev
npm run auto-production:status
npm run auto-production:preview
npm run auto-production:run
```

Codex 로컬 로그인이 유효한지는 실행 전 아래처럼 확인합니다. `Logged in` 상태가 아니면 `codex login`으로 다시 인증하며, 자동 제작은 유료 API로 대신 전환되지 않습니다.

```bash
codex login status
```

특정 광고주만 실행할 수 있습니다.

```bash
npm run auto-production:preview -- --advertiser=kookdae-hanwoo
npm run auto-production:run -- --advertiser=kookdae-hanwoo --force
```

`auto-production:run`은 현재 시각에 실행 대상인 광고주만 처리합니다. `--force`는 예약 시각을 기다리지 않는다는 뜻이며, 같은 영업일·광고주 실행 키의 중복 방지는 해제하지 않습니다.

## 앱 내부 스케줄러

Next.js Node 런타임이 시작되면 루트 `instrumentation.ts`가 1분 간격으로 도래한 광고주를 확인합니다. 프로세스가 재시작되면 저장된 실행/GenerationJob을 다시 조회해 중단된 항목만 재개합니다. 한 상품의 실패는 같은 실행의 다른 상품을 막지 않으며 결과 상태는 `완료`, `일부 완료`, `실패`로 남습니다.

개발 서버 또는 단일 상시 Node 서버에서는 이것만으로 예약 실행할 수 있습니다. 서버리스 환경처럼 프로세스가 항상 살아 있지 않으면 아래 OS 스케줄러나 배포 플랫폼의 cron이 CLI/API를 호출해야 합니다.

## macOS launchd 예시

Node와 프로젝트 절대 경로는 `which node`, `pwd`로 확인합니다. 아래 내용을 `~/Library/LaunchAgents/com.daywiz.auto-production.plist`에 저장하고 경로를 현재 환경에 맞게 바꿉니다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.daywiz.auto-production</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/USER/adatlas/scripts/run-daily-auto-production.mjs</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/USER/adatlas</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/daywiz-auto-production.log</string>
  <key>StandardErrorPath</key><string>/tmp/daywiz-auto-production-error.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.daywiz.auto-production.plist
launchctl start com.daywiz.auto-production
```

Mac이 잠들어 있으면 정시 실행이 지연될 수 있습니다. 미팅용 또는 업무용 Mac에서는 전원 연결 상태에서 잠자기 설정을 확인하거나 상시 서버 cron을 사용합니다.

실행 로그는 plist에 지정한 파일에서 확인합니다.

```bash
tail -f /tmp/daywiz-auto-production.log
tail -f /tmp/daywiz-auto-production-error.log
```

## Windows 작업 스케줄러 예시

1. 작업 스케줄러에서 `기본 작업 만들기`를 선택합니다.
2. 매일 오전 12시(00:00, 날짜가 바뀌는 자정) 트리거를 지정합니다.
3. 프로그램에 Node 실행 파일, 인수에 `scripts\\run-daily-auto-production.mjs run`, 시작 위치에 저장소 경로를 넣습니다.
4. 실패 시 5분 간격으로 최대 3회 다시 시작하도록 설정합니다.
5. 작업의 `기록` 탭에서 최근 실행 시각, 종료 코드, 오류를 확인합니다.

PowerShell에서 먼저 동일 명령이 성공하는지 확인합니다.

```powershell
cd C:\path\to\adatlas
npm run auto-production:status
npm run auto-production:run
```

## 일상 운영

- `/admin/auto-production` 상단에서 다음 실행, 계획/완료/확인 필요 수를 확인합니다.
- `오늘 후보 미리보기`에서 상품 근거와 추천 역할을 검토합니다.
- 광고주 또는 전체 자동 제작을 일시정지할 수 있습니다.
- 새 광고주는 일시정지 상태로 저장되며 설정 확인 후 명시적으로 활성화합니다.
- 상단 `일일 생성 한도`는 활성 광고주의 전체 6장 제작 계획보다 낮출 수 없으며 최대 120장까지 설정할 수 있습니다.
- 자동으로 선택된 각 상품은 수동 제작과 똑같이 배정된 6개 레퍼런스 전체를 제작합니다.
- 최근 결과는 오늘·어제·최근 7일 또는 직접 지정한 기간으로 조회합니다.
- 완성 결과는 자동제작 화면에서 한 장씩 확인하고 개별 다운로드, 상품별 ZIP, 실행 전체 ZIP으로 내려받습니다.
- 소재코드, 권장 광고명, UTM은 결과와 함께 복사합니다.
- `.env.local`, API 키, 로컬 파일 경로, Codex 내부 스레드 정보는 화면이나 로그에 노출하지 않습니다.

## 장애 복구

- 상태가 오래 `제작 중`이면 `/api/auto-production/status` 또는 상태 화면 새로고침이 복구 검사를 수행합니다.
- 서버 재시작 후 v12 GenerationJob의 완료 결과와 선택 레퍼런스는 유지되며 미완료 결과만 재개합니다.
- 데이터 소스 실패 원인은 실행 경고에 남고 대체 소스가 사용됩니다.
- 일부 상품만 실패하면 성공한 상품은 그대로 다운로드할 수 있습니다.
- Codex 로그인이 만료되었거나 생성 제공자가 준비되지 않으면 유료 API로 자동 전환하지 않고 해당 상품을 실패로 기록합니다.

## 검증

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

테스트와 빌드 과정에서는 실제 유료 이미지 생성을 호출하지 않습니다.

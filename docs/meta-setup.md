# Meta Marketing API 안전 연결

AdAtlas의 Meta 기능은 기본적으로 읽기와 쓰기가 모두 꺼져 있고 `dry-run`이 켜져 있다. 페이지 열기, 쇼핑몰 분석, 광고 생성, 결과 조회, 성과 화면 진입만으로 Meta API를 호출하지 않는다.

## 권장 전용 자산

1. Meta Business Manager에서 AdAtlas 전용 앱과 시스템 사용자를 만든다.
2. 최소 권한의 장기 토큰을 서버 환경변수 `META_SYSTEM_USER_ACCESS_TOKEN`에만 저장한다.
3. `META_ALLOWED_AD_ACCOUNT_IDS`에 운영을 허용할 광고 계정만 쉼표로 등록한다.
4. 광고주별 자산은 UI의 `광고주 설정` 또는 `META_ADVERTISER_ASSET_MAP_JSON`에 매핑한다.
5. 실제 선택 가능한 계정은 시스템 사용자 접근 계정, 서버 허용 목록, 광고주 매핑의 교집합이다.

## 단계별 활성화

1. 먼저 `META_READ_ENABLED=true`, `META_WRITE_ENABLED=false`, `META_DRY_RUN=true`로 연결·계정·기존 캠페인·기존 광고 세트를 읽기 전용으로 확인한다.
2. USD 계정은 일 예산 USD 5(API minor unit `500`)만 지원한다. 비USD 계정은 환율 변환 없이 `META_ADSET_BUDGET_BY_ACCOUNT_JSON`의 승인값이 정확히 일치해야 한다.
3. 사전 검토에서 기존 수동 판매·웹 Purchase ABO 캠페인, 기준 광고 세트, 단일 미디어 H01~H06, 고정 랜딩·UTM, `SHOP_NOW`, PAUSED 상태를 확인한다.
4. 운영자가 실제 Meta UI에서 페이로드와 자산을 검증한 뒤에만 `META_WRITE_ENABLED=true`, `META_DRY_RUN=false`로 전환한다.
5. UI의 최종 체크와 일회성 확인 토큰을 거쳐 한 상품만 PAUSED 초안으로 등록한다. ACTIVE 생성, 캠페인 변경, 기존 자산 변경, 자동 게시 기능은 코드 허용 목록에 없다.

## 성과 읽기

성과는 `성과 추적 시작` 후 `성과 새로고침`을 눌렀을 때 최근 3일을 `ad_id + 날짜`로 upsert한다. 기본 스케줄러는 꺼져 있다. 자동 수집을 사용하려면 로컬 서버가 실행 중인 조건과 중지 절차를 확인한 뒤 `META_INSIGHTS_SCHEDULER_ENABLED=true`를 별도로 승인한다.

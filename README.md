# DAYWIZ AdAtlas

DAYWIZ AdAtlas는 상품 상세페이지의 공개 근거를 바탕으로 광고 후킹을 기획하고, 후킹마다 서로 다른 완성 광고 이미지를 만드는 Next.js 기반 광고 콘텐츠 운영 도구입니다.

기본 제작 경로는 고정 템플릿에 문구를 끼우거나 배경과 누끼를 기계적으로 합성하지 않습니다. 상품 원본 사진을 참조한 AI가 장면, 제품 표현, 한국어 문구, CTA, 타이포그래피, 레이아웃을 한 번에 완성합니다.

## 왜 만들었는가

상품마다 고객이 반응하는 이유는 다르지만 기존 제작 방식은 동일 디자인의 문구 교체에 머무르기 쉽습니다. AdAtlas는 공개 상품 근거와 연결 데이터로 서로 다른 메시지 가설을 세우고, 실제 테스트 가능한 소재·광고명·UTM까지 한 흐름으로 연결하기 위해 만들었습니다.

핵심 사용자는 광고할 상품을 찾는 퍼포먼스 마케터, 상품 근거를 광고 기획으로 바꾸는 콘텐츠 마케터, 그리고 승인 가능한 완성 소재를 빠르게 검토해야 하는 광고주·디자이너입니다.

## 기본 제작 흐름

```text
상품 상세페이지 URL 분석
→ ProductTruth 구성
→ 로컬 Codex(gpt-5.6-sol, high)로 후킹 후보 12~15개 기획
→ 상품 근거·구체성·차별성·주목도·시각화·광고 적합성 평가
→ 최종 후킹 6개 선정
→ 상품명·카테고리·상세설명·USP·고객문제·이미지·브랜드 분위기로 CategoryCreativeProfile 결정
→ 후킹별 완성형 CreativeBrief 작성
→ 후킹별 독립 광고 브리프와 독립 완성 이미지 생성
→ 개별 AI QA 및 최대 2회 수정
→ 6장 그룹 다양성 QA 및 중복 이미지만 재생성
→ 1200×1200 JPEG, 800KB 이하 검증
→ 소재코드·권장 광고명·UTM·랜딩 URL과 함께 전달
```

서비스의 기본 사용자 흐름은 다음 네 단계입니다.

1. 광고 후보 찾기
2. 상품 선택 또는 URL 입력
3. AI 광고 6장 만들기
4. 결과 확인 및 테스트

제작 화면 안에서는 `상품 확인 → 광고 목표 선택 → 후킹 6개 선정 → AI 광고 6장 완성` 순서로 현재 상태를 보여줍니다.

완성 카드에서는 문구를 직접 편집하지 않습니다. `이 광고 다시 만들기`, 자연어 `AI에게 수정 요청`, `승인`, `제외`로 관리합니다.

## 카테고리별 AI 아트디렉션

`food_meat`, `food_fresh`, `food_processed`, `beauty_cosmetics`, `personal_care`, `fashion`, `health`, `household`, `kids`, `general`을 지원합니다. 이 프로필은 고정 템플릿이 아니라 장면·사람 역할·제품 표현·색·조명·타이포그래피·금지 요소를 정하는 광고 문법입니다.

- 육류·식품: 실제 부위·구성·패키지를 보존하면서 조리 행동, 육즙·김·윤기, 완성 메뉴, 식사 상황을 후킹에 맞게 선택합니다.
- 화장품·퍼스널케어: 제품 히어로, 감각 몰입, 실제 사용 행동, 문제 해결, 검증된 성분·근거를 후킹별로 선택합니다.
- 후기형은 실제 후기 근거가 있을 때만, 가격·효능·임상·인증은 검증 사실에 있을 때만 사용합니다.
- 최종 6장은 최소 4개의 서로 다른 visualArchetype을 사용하고 그룹 QA에서 배경·구도·카메라·색·타이포그래피 반복을 검사합니다.

각 CreativeBrief에는 고객 상황과 의도 반응, visualArchetype, 히어로 장면, 사람·제품 역할, 카메라, 구도, 색, 조명, 타이포그래피, 보조 요소, 검증 사실, 금지 주장, 다른 후킹과의 차이를 저장합니다.

## AI 엔진 정책

기본 엔진은 설치된 Codex CLI와 현재 ChatGPT 로그인을 사용하는 `codex_local`입니다.

- 후킹 기획: `gpt-5.6-sol`, reasoning `high`
- 광고 생성: 광고주별 생성 스레드
- 개별 QA: 생성 스레드와 분리된 새 검수 스레드
- 그룹 QA: 6장 콘택트시트를 검사하는 별도 검수 스레드
- 로컬 Codex가 불가능할 때만 근거 기반 규칙 후킹으로 fallback하며 내부 기록에 남김
- 유료 OpenAI API는 UI에서 `openai_api`를 명시 선택하고 서버 플래그를 켠 경우에만 사용
- 로컬 Codex 실패를 유료 API로 자동 전환하지 않음

## 상품 이미지 원칙

- 상세페이지의 실제 상품 사진을 우선 사용합니다.
- 패키지 형태, 라벨 인상, 색상, 옵션과 수량을 최대한 보존합니다.
- 자동 누끼와 기존 광고 배너는 기본 참조에서 제외합니다.
- 정면, 라벨, 실제 판매 구성, 손·사용 장면, 질감·원료 순으로 중복 없는 원본을 최대 5장 전달합니다.
- 확인되지 않은 가격, 할인, 구성, 후기, 평점, 효능, 인증, 원산지와 성과 수치를 생성하지 않습니다.
- 상품과 무관한 이미지를 fallback으로 사용하지 않습니다.

## 생성 결과와 보안

AI 생성 원본, 수정본, 프롬프트, ProductTruth 원문, 후킹 후보, QA 상세, Codex thread ID는 웹 공개 폴더에 두지 않습니다.

```text
.data/generated/{advertiserId}/{jobId}/
  manifest.json
  product-analysis.json
  hook-hypotheses.json
  diversity-matrix.json
  references/
  H01/ ... H06/
  qa/

.data/creative-generation/jobs/
  creative-job-*.json

.data/codex/golden-references/{advertiserId}/
  golden-*.jpg
```

최종 광고도 `.data/generated`에 저장되며 localhost 접근 검사를 거치는 이미지·다운로드 API로만 전달됩니다. `public/generated`의 이전 native 결과는 다음 명령으로 비공개 저장소로 이전할 수 있습니다.

```bash
node scripts/migrate-native-generated-assets.mjs
```

사이트 URL 후보 분석 캐시는 `.data/site-candidates/cache.json`에 TTL, 원본 URL, 분석 결과, 선택 결과와 함께 저장되어 서버 재시작 후에도 복구됩니다.

## 주요 기능

### 광고 후보 찾기

- 쇼핑몰 URL 기반 상품 발견과 공개정보 분석
- BigQuery·크리마 데이터 연결 시 상품 기회 탐지
- 콘텐츠 적합도와 추천 근거 표시
- 선택 상품 URL을 제작 화면에 자동 전달

### 상세페이지로 광고 만들기

- 상품 정보와 원본 이미지 추출
- 광고 목표 확인
- 상품별 후킹 후보 기획과 최종 6개 선정
- 후킹별 독립 AI 완성 광고 생성
- 실시간 카드 상태, 복구, 개별 수정·승인·제외·다운로드

### 자동 제작

- 기본 운영값: 광고주 3곳, 매일 Asia/Seoul 오전 9시
- 광고주별 상품 4개, 상품별 우선 광고 1장, 기본 일 12장
- 관리자 설정, 중복 방지, 중단 작업 복구
- SHA-256 기반 상품 작업 ID로 React key와 작업 기록의 고유성 보장

### 후킹 테스트와 성과 학습

- 동일 상품의 서로 다른 메시지 가설을 소재코드로 연결
- 캠페인 목표별 성과 연결
- 승인·제외·자연어 피드백은 표현 방향 학습에만 사용하며 판매 성과로 간주하지 않음
- `골든 레퍼런스로 등록`한 광고는 광고주·카테고리·상품·시각 문법·추상 스타일 특성과 함께 비공개 저장
- 다음 생성에서는 같은 카테고리와 성과 데이터가 있는 골든 레퍼런스를 우선하되 기존 문구나 레이아웃을 복사하지 않음

### 영상 제작 협업

- 이미지 광고 생성과 분리된 프로젝트별 영상 대본·제작·검수 흐름
- 소재코드 날짜는 서버 위치와 무관하게 Asia/Seoul 기준
- 영상 자체를 AI로 생성하거나 편집하는 모듈은 아님

## 레거시 도구

배경 라이브러리, 템플릿 렌더러, 누끼, Canvas/SVG/Sharp 합성, 직접 문구 편집 코드는 기존 기록과 관리 기능의 호환성을 위해 격리되어 있습니다. `/create-product` 기본 제작 화면에는 노출되지 않으며 AI-native 작업 생성 경로에서 호출하지 않습니다.

## 기술 구성

- Next.js App Router
- TypeScript / React
- `@openai/codex-sdk`
- 선택형 OpenAI API
- sharp
- JSON 파일 저장(MVP)
- BigQuery / Crema 선택 연동

## 로컬 실행

요구 사항:

- Node.js 20 이상
- Codex CLI 설치 및 `codex login`

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. native 광고 생성 API는 기본적으로 localhost에서만 허용됩니다.

주요 환경변수:

```env
ADATLAS_CODEX_MODEL=gpt-5.6-sol
ADATLAS_CODEX_PLANNING_TIMEOUT_MS=180000
ADATLAS_CODEX_IMAGE_TIMEOUT_MS=720000
ADATLAS_CODEX_VALIDATION_TIMEOUT_MS=150000
ADATLAS_CREATIVE_CONCURRENCY=2
ADATLAS_CREATIVE_RETRIES=2
ADATLAS_PAID_API_EXPLICIT_ENABLED=false
```

유료 API 사용 시에만 `OPENAI_API_KEY`를 서버 환경에 두고 `ADATLAS_PAID_API_EXPLICIT_ENABLED=true`를 설정합니다. 어떠한 키도 `NEXT_PUBLIC_*`로 노출하지 않습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

기능 변경은 기존 URL 안전성, 사이트 후보 분석, 자동 제작, 영상 협업, 소재코드, 후킹 실험 테스트를 함께 통과해야 합니다.

## 운영 문서

- [자동 제작 운영 가이드](docs/auto-production-operations.md)
- [MVP 테스트 기획서](docs/adatlantis-mvp-plan.md)
- [레거시 배경 라이브러리 문서](docs/background-library.md)

## 현재 한계

- AI가 만든 패키지 라벨과 한국어가 매번 완벽하다고 보장할 수 없어 독립 QA와 사용자 승인이 필요합니다.
- 로컬 Codex 로그인, 이미지 생성 기능, 충분한 실행 시간이 필요합니다.
- 사이트 URL 분석은 공개 페이지에서 확인되는 사실만 사용하며 판매량·전환율·ROAS를 예측하지 않습니다.
- JSON 파일 저장은 단일 서버 MVP에 적합하며 다중 인스턴스 운영에는 공유 데이터베이스와 작업 큐가 필요합니다.
- 사이트 내부 알림만 구현되어 있으며 Slack·메일 알림은 아직 제공하지 않습니다.

## 향후 고도화 방향

- 다중 서버용 영속 작업 큐와 객체 저장소
- 승인·제외·실제 광고 성과를 결합한 광고주별 장기 학습
- 소재 피로와 재테스트 시점 탐지
- Slack·메일 알림과 팀 승인 워크플로
- 상품 동일성·한국어 가독성 자동 평가의 정밀도 향상

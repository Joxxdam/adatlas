# 광고 콘텐츠 6장 자동생성 명세

## 목표

상품 URL 분석이 끝나면 추가 필수 설정 없이 `광고 콘텐츠 6장 만들기`를 실행한다. 결과는 1200×1200 정사각형 광고이며 각 카드가 독립적으로 생성·검수·재시도된다.

기존 단일/일괄 템플릿 렌더러, `selectedAdImages`, 상품 누끼, 카피 가이드, 배경 라이브러리는 삭제하거나 초기화하지 않는다. 새 기능은 별도 작업 API와 UI 패널로 이 입력을 재사용한다.

## 파이프라인

```text
ProductInfo + selectedAdImages
  → ProductTruth
  → BrandProfile + CategoryProfile
  → HookPlan × 6
  → CreativeBlueprint × 6
  → ScenePlan (library first)
  → RenderPlan
  → 1200×1200 WebP render
  → QA + one repair pass
  → progressive result cards
```

## 핵심 타입

- `ProductFact`: 값, 출처, 검증 상태, 카피 사용 가능 여부, 숫자 토큰을 보관한다.
- `ProductTruth`: 광고에 사용할 수 있는 상품 사실과 금지 표현의 유일한 기준이다.
- `BrandProfile`: 브랜드 색, 톤, 로고, 금지 주장, 장면/블루프린트 선호를 데이터로 관리한다.
- `CategoryProfile`: 미매칭 브랜드의 타깃·색·장면·블루프린트 fallback을 정의한다.
- `HookPlan`: 한 광고 카드의 후킹, 문구, 타깃, 사용 fact ID를 기록한다.
- `CreativeBlueprint`: 슬롯, safe area, 제품/로고 위치, 팔레트 정책을 정의한다.
- `ScenePlan`/`SceneAsset`: 재사용 장면의 파일, 출처, 라이선스, 생성 여부를 추적한다.
- `RenderPlan`: 최종 카피, 배치, 색, 제품 이미지, 장면, 출력 계약을 스냅샷으로 저장한다.
- `QAResult`: 해상도, 포맷, 파일 크기, 재디코딩, 글자, 대비, 상품 면적, 사실 안전성을 기록한다.
- `GenerationJob`/`GenerationResult`: 6개 결과의 상태, 시도 횟수, 시간, 오류, 재개 정보를 JSON으로 저장한다.

## 사실 안전성

가격·기존가·할인·구성·중량·리뷰·평점·성과 수치는 구조화된 사실 또는 상세페이지 출처가 있을 때만 사용할 수 있다. 카피에서 발견한 숫자 토큰은 `ProductTruth.allowedNumericTokens`에 정확히 있어야 한다.

`-72%`, `-8.9°C` 같은 레퍼런스 수치는 시각 구조를 설명하는 메타데이터일 뿐 상품 사실로 가져오지 않는다. 판매량, 매출, 재고, 마진, ROAS, 회원 수, 구매 수는 공개 ProductTruth에 없으면 항상 금지한다.

## 출력 계약

- 가로 1200px, 세로 1200px
- WebP 또는 JPEG
- 결과 한 장당 800KB 이하
- 파일 저장 후 실제 디코딩 재검사
- 48px 기본 외곽 safe area
- 헤드라인 권장 최소 48px, 보조 문구 최소 28px
- 제품 의도 면적 12% 이상
- 하나의 카드가 실패해도 다른 카드는 계속 진행
- 성공한 결과만 전체 ZIP에 포함

## API

- `POST /api/creative-generation/jobs`: ProductTruth, 6개 계획, 장면을 생성하고 작업을 저장한다.
- `GET /api/creative-generation/jobs/:jobId`: 진행 중인 작업을 복구한다.
- `PATCH /api/creative-generation/jobs/:jobId`: `cancel` 또는 `resume`.
- `POST /api/creative-generation/jobs/:jobId/results/:resultId`: 카드 하나를 생성하거나 수정 문구로 재생성한다.

런타임 작업은 `data/creative-generation-jobs/`, 결과 이미지는 `public/generated-ads/`에 저장되며 둘 다 생성물은 Git에서 제외된다.

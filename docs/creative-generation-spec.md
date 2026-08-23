# ZIP 레퍼런스 기반 광고 콘텐츠 6장 생성 명세

## 현재 기본 경로

상품 URL 분석이 끝나면 상품 확인 카드에서 `이 상품으로 광고 만들기`를 한 번 누릅니다. 추가 필수 설정 없이 서버 작업이 자동 시작되며 결과는 1200×1200 JPEG, 각 광고는 독립적으로 생성·검수·재시도됩니다.

이 문서가 현재 native 광고 6장 생성의 기준입니다. 기존 배경 라이브러리, text-free 장면 생성, 고정 템플릿 렌더러, 누끼·Canvas/SVG/Sharp 상품/문구 합성은 레거시·고급 도구이며 이 기본 경로에서 호출하지 않습니다.

## 입력 레퍼런스

- 원본: 사용자 제공 `이미지참고복사용.zip`
- 초기 등록 이미지: 113장. 이후 `/admin/references` 관리 화면의 업로드·삭제 결과에 따라 현재 제작 풀은 증감합니다.
- 이미지: `public/creative-references/reference-copy/`
- manifest: `data/native-creative-reference-library.json`
- 등록 스크립트: `scripts/import-native-creative-references.mjs`
- manifest의 카테고리 분류는 `fashion`, `food`, `beauty` 세 값만 사용합니다.
- 건강·웰니스, 퍼스널케어와 별도 분류가 필요하지 않은 기능성 상품은 `beauty`에 포함합니다.
- 현재 ZIP은 식품 48장과 화장품 65장이며 패션 레퍼런스는 파일명에 패션·의류·신발·가방 등의 식별어가 있는 경우 `fashion`으로 등록합니다.
- 새 수동 작업은 상품과 같은 카테고리 풀에서 중복 없이 6장을 무작위 선택합니다.
- 같은 상품군이 6장 미만일 때만 가까운 풀에서 부족한 수를 보충하며, 패션에는 식품 레퍼런스를 섞지 않습니다.
- HookPlan, 가격형·감각형 같은 카피 분류는 선택 조건이 아닙니다.
- 선택된 6장은 작업 생성 시 `GenerationResult.nativeCreative.adReference`에 저장합니다.
- 새로고침, 서버 복구, 개별 재시도와 같은 레퍼런스 재생성에서는 다시 추첨하지 않습니다.

입력 레퍼런스는 생성 엔진이 읽을 수 있도록 public 경로에 있지만 기본 제작 UI에서 대기 카드로 미리보지 않습니다. 외부 배포 전 이미지 권리와 공개 범위를 확인해야 합니다.

## 기본 진행 UI

- 버튼 클릭 직후 `광고 제작을 준비하고 있습니다`를 표시합니다.
- 실행 중에는 `n장째 광고를 제작 중입니다`, `현재 진행 n/6`, `완료 x/6`을 표시합니다.
- 1~6 상태칸은 `대기`, `제작 중`, `완료`, `확인 필요`를 구분합니다.
- 성공한 결과는 한 장씩 결과 그리드에 추가하며 대기 중인 레퍼런스 카드는 표시하지 않습니다.
- 성공·승인 결과가 6장일 때만 `6장 ZIP 다운로드`를 활성화합니다.
- 재시도, 개별 수정·다운로드, Meta 문구 같은 도구는 접힌 상세 영역에 둡니다.

## 파이프라인

```text
상품 URL + 상세페이지 원본 이미지
  → ProductTruth
  → ProductTruth 기반 Copy/HookPlan × 6
  → 상품 카테고리 매칭
  → 같은 상품군 ZIP 풀에서 Unique Random Reference × 6
  → 선택 결과를 GenerationJob에 영구 저장
  → Stage 1: Reference Recreation
  → Stage 2: Product-only Replacement
  → Stage 3: Copy-only Replacement
  → Stage 4: Reference/Product/Copy QA Repair
  → 최종 AI Validation
  → 1200×1200 JPEG, 800KB 이하 Export
  → 소재코드·광고명·UTM 저장
```

## 단계 잠금 계약

### Stage 1 — Reference Recreation

- 선택한 완성 광고를 고해상도 정사각 작업 마스터로 재현합니다.
- 구성, 배경, 색, 타이포 위계, 상품 수와 위치, 배지, 하단 띠, 정보 밀도를 최대한 유지합니다.
- 이 중간 단계에서는 원본 상품과 문구가 임시로 남을 수 있습니다.
- 새 장면, 빈 템플릿, 중립 proxy 상품, 와이어프레임으로 재해석하지 않습니다.

### Stage 2 — Product-only Replacement

- 첫 첨부 이미지는 Stage 1 결과, 나머지는 URL 상세페이지의 권위 있는 상품 원본입니다.
- 원본 광고의 상품 인스턴스만 실제 URL 상품으로 교체합니다.
- 배경, 문구, 가격, 배지, 색, 도형, 간격, 레이아웃은 잠급니다.
- 상품 형태, 패키지, 색, 뚜껑, 라벨 위계와 판매 단위를 보존합니다.
- 반복 배치는 같은 상품의 시각적 반복일 뿐 검증되지 않은 묶음 구성으로 표현하지 않습니다.

### Stage 3 — Copy-only Replacement

- 첫 첨부 이미지는 Stage 2 결과입니다.
- 원본 광고주의 문구, 가격, 로고와 source-specific 배지만 ProductTruth 기반 내용으로 교체합니다.
- 상품, 배경, 배치와 다른 디자인 픽셀은 잠급니다.
- 정확한 한국어 문자열을 임의로 바꾸거나 ProductTruth에 없는 수치를 추가하지 않습니다.

### Stage 4 — QA Repair

- Stage 3 결과, URL 상품 원본, 선택한 ZIP 레퍼런스를 함께 비교합니다.
- 레퍼런스 구성 충실도, 상품 동일성, 한국어·가격·혜택 정확성, 모바일 가독성을 검사합니다.
- 자동 수정은 기본 최대 1회이며 전체 콘셉트를 새로 만들지 않습니다.
- 최종 이미지에는 원본 광고주의 상품·문구·가격·로고가 남으면 안 됩니다.

## 핵심 타입

- `ProductTruth`: 광고에 사용할 수 있는 상품 사실과 금지 표현의 유일한 기준
- `HookPlan`: 교체할 한국어 문구, 사용 fact ID, H01~H06 성과 추적 코드
- `NativeAdReference`: ZIP에서 선택한 광고의 ID, 상품군, public path, source file과 선택 이유
- `NativeCreativeArtifact.stagePaths`: 구조 재현, 상품 교체, 문구 교체, QA 수정 중간 결과
- `NativeCreativeValidation`: 디자인 충실도·상품 동일성·문구 정확성·가독성 검수
- `GenerationJob`/`GenerationResult`: 6개 선택·상태·시도·복구 정보를 JSON으로 저장

H01~H06은 카피와 성과 추적 코드입니다. 시각 장면을 새로 설계하거나 ZIP 레퍼런스를 선택하는 기준이 아닙니다.

## 사실 안전성

가격·기존가·할인·구성·중량·리뷰·평점·효능·인증·성과 수치는 구조화된 사실 또는 상세페이지 출처가 있을 때만 사용할 수 있습니다. 원본 광고에 보이는 가격과 주장은 target ProductTruth로 승계하지 않습니다.

판매량, 매출, 재고, 마진, ROAS, 회원 수, 구매 수는 공개 ProductTruth에 없으면 항상 금지합니다.

## 출력 계약

- 정확히 1200×1200 JPEG
- 결과 한 장당 800KB 이하
- 파일 저장 후 실제 디코딩 재검사
- 하나의 카드가 실패해도 다른 카드는 계속 진행
- 성공·승인 결과만 검수 완료 ZIP에 포함
- 소재코드·권장 광고명·UTM·랜딩 URL 연결

## API와 저장

- `POST /api/creative-generation/jobs`: ProductTruth, 문구 계획, 상품군 우선 레퍼런스 6장을 저장하고 서버 작업 시작
- `GET /api/creative-generation/jobs/:jobId`: 진행 중 작업 복구
- `PATCH /api/creative-generation/jobs/:jobId`: `cancel` 또는 `resume`
- `POST /api/creative-generation/jobs/:jobId/results/:resultId`: 카드 생성·재생성·문구 수정·검수 처리

작업 버전은 `generation-job-v12-category-reference-edit`입니다. 시작하지 않은 v11 작업은 처음 복구할 때 상품군 우선 레퍼런스로 재배정해 v12로 올립니다. 이미 편집을 시작한 과거 작업은 기존 배정을 보존합니다.

런타임 작업과 AI 중간 결과는 `.data/` 비공개 저장소에 두고 공개 API가 로컬 경로·프롬프트·인증정보를 제거합니다.

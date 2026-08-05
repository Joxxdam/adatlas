# AdAtlas Codex Instructions

## Project Overview

AdAtlas는 Next.js + TypeScript 기반의 퍼포먼스 광고 소재 자동화 도구입니다.

AdAtlas의 목적은 단순히 이미지를 생성하는 것이 아니라 다음 광고 제작 흐름을 자동화하는 것입니다.

### 분석 후 제작하기

업체 URL 분석
→ 카테고리 및 상품 후보 수집
→ 후기·가격·USP·이미지 분석
→ 광고하기 좋은 상품 및 콘텐츠 가설 추천
→ 사용자가 상품과 전략 선택
→ 기존 소재 제작 화면으로 전달
→ 문구·이미지·템플릿 생성

### 선택 상품 제작하기

상품 URL 입력
→ 상품정보 및 상세 이미지 추출
→ 업체별 카피 가이드 매칭
→ 광고 문구 생성
→ 이미지 선택
→ 템플릿 선택
→ 단일 또는 일괄 렌더링
→ 다운로드

두 흐름은 사용자 경험상 분리하되, 상품정보 추출·문구 생성·이미지 선택·템플릿 추천·렌더링 엔진은 최대한 공유합니다.

---

## Tech Stack

- Next.js App Router
- TypeScript
- React
- OpenAI API
- Canvas/SVG rendering
- sharp
- remove.bg API
- JSON file storage for MVP

새 라이브러리는 기존 기능으로 해결하기 어려운 경우에만 추가합니다.

라이브러리를 추가한 경우 다음을 보고해야 합니다.

- 패키지명
- 추가한 이유
- 사용 위치
- 기존 대안으로 해결할 수 없었던 이유

---

## Repository First

작업을 시작하기 전에 현재 저장소 구조와 실제 구현 상태를 먼저 확인합니다.

문서에 적힌 파일이 없거나 경로가 변경되었다면 새 중복 파일을 만들기 전에 현재 구현을 찾아 확장합니다.

다음을 먼저 확인합니다.

- 현재 페이지 및 라우팅 구조
- 메인 제작 UI
- 상품정보 추출 API
- 문구 생성 API
- 템플릿 정의
- 단일 및 일괄 렌더링 흐름
- 이미지 선택 상태
- 업체별 카피 가이드
- 레퍼런스 분석 JSON
- 자동 디자인 및 레이아웃 관련 helper

기존 기능과 동일한 역할의 타입·helper·service를 중복 생성하지 않습니다.

---

## Important Areas

### Creation UI

주요 역할:

- 제작 방식 선택
- 업체 분석
- 선택 상품 제작
- 이미지 선택
- 문구 생성
- 템플릿 선택
- 단일/일괄 생성
- 렌더 품질 진단 표시

현재 구현 위치는 저장소를 먼저 확인합니다.

기존 `MvpDashboard`가 메인 제작 UI라면 기능을 제거하지 않고 재사용하거나 안전하게 분리합니다.

### Store Analysis

업체 URL을 기준으로 가능한 범위에서 다음을 분석합니다.

- 업체 및 브랜드 정보
- 플랫폼
- 카테고리
- 베스트·신상품·할인 상품
- 상품명·가격·할인율
- 후기 수·평점
- 상세 이미지
- USP
- 상세페이지 품질
- 콘텐츠 확장성
- 광고 적합도
- 추천 콘텐츠 가설

공개 페이지에서 확인할 수 없는 판매량·매출·재고·마진·ROAS는 생성하지 않습니다.

### Copy Generation

문구 생성은 다음 구조를 유지합니다.

productInfo
→ matched brand copy guide and structured copy patterns
→ reference signals
→ masterCopy
→ independent copyVariants
→ template copy planning and fitting
→ activeRenderCopy
→ render API

### Rendering

렌더링은 가능한 경우 다음 공통 흐름을 사용합니다.

productImagePaths 결정
→ palette 결정
→ copy variant 선택
→ template slot 로드
→ text fitting
→ image fitting
→ collision resolving
→ final render
→ diagnostics

기존 템플릿이 새 공통 엔진으로 이전되지 않았다면 기존 렌더러 fallback을 유지합니다.

---

## Core Copy Concepts

### masterCopy

`masterCopy`는 상품 기준으로 생성된 기본 광고 문구입니다.

규칙:

- 특정 템플릿 하나에 종속되지 않습니다.
- 상품 사실과 업체별 카피 가이드를 중심으로 생성합니다.
- 템플릿을 변경해도 자동으로 다시 생성하지 않습니다.
- 템플릿은 기존 문구 중 적합한 variant를 선택합니다.

### copyVariants

필수 variant:

- short
- medium
- long

규칙:

- 세 variant는 서로 독립적으로 생성합니다.
- long을 잘라서 medium이나 short를 만들지 않습니다.
- substring, slice, 단순 말줄임으로 variant를 생성하지 않습니다.
- 같은 상품 사실을 사용하되 길이에 맞는 별도 패턴과 문장 구조를 사용합니다.
- short는 짧고 강한 후킹형입니다.
- medium은 일반 광고 템플릿에 맞는 자연스러운 문장입니다.
- long은 브랜드 말투와 정보량을 가장 풍부하게 반영합니다.

업체 카피 가이드에서 허용하는 경우 short와 medium에는 `..`, `,,`, `;;`, `?!` 등의 구어체 말끝을 사용할 수 있습니다.

모든 문구에 기호를 기계적으로 붙이지 않습니다.

### activeRenderCopy

`activeRenderCopy`는 실제 렌더 API에 전달하는 최종 문구입니다.

계산 기준:

masterCopy
+ copyVariants
+ selectedTemplate
+ templateCopyMode
+ template slots and copy limits
+ actual fitting result
→ activeRenderCopy

렌더 API에는 원칙적으로 `activeRenderCopy`를 전달합니다.

### templateCopyMode

지원 모드:

- `original`
  - 원문을 사용합니다.
  - overflow 가능성을 diagnostics에 표시합니다.

- `auto-variant`
  - 기본 모드입니다.
  - 실제 슬롯 fitting 결과를 기준으로 short/medium/long을 선택합니다.

- `force-fit`
  - 원문을 기준으로 가능한 범위에서 크기와 줄바꿈을 조정합니다.
  - 의미를 훼손하는 임의 축약은 하지 않습니다.

---

## Copy Source Priority

문구 생성은 다음 우선순위를 따릅니다.

1. `productInfo`
   - 상품명, 가격, 할인율, 구성, 설명 등 사실의 기준입니다.

2. 업체별 카피 가이드와 구조화된 카피 패턴
   - 브랜드의 고정 톤, 문장 구조, 자주 사용하는 표현을 정의합니다.
   - 실제 문구 생성의 1차 스타일 소스입니다.

3. 레퍼런스 분석 데이터
   - 후킹 방향, 광고 구조, 시각 톤, 슬롯 구성, 템플릿 추천을 위한 보조 신호입니다.

4. 템플릿 조건
   - 문구를 새로 만드는 소스가 아니라, 이미 생성된 variant 중 실제 공간에 맞는 것을 선택하는 조건입니다.

다음 정보는 근거 없이 생성하면 안 됩니다.

- 가격
- 기존가
- 할인율
- 수량
- 중량
- 등급
- 리뷰 수
- 평점
- 판매량
- 구매 수
- 회원 수
- 재고
- 마진
- 매출
- 성과 수치

---

## Brand Copy Guide Rules

업체별 카피 가이드와 패턴 데이터는 해당 파일을 원본으로 사용합니다.

일반적인 위치:

- `data/copy-guides/*.md`
- `data/copy-guides/*.json`
- `data/copy-guides/index.json`
- 관련 TypeScript pattern loader 또는 builder

매칭 기준:

- advertiserName
- brandName
- product URL domain
- productName
- aliases

규칙:

- 브랜드 가이드 파일의 표현 방식과 분류를 보존합니다.
- 가이드의 예시를 상품과 무관하게 그대로 복사하지 않습니다.
- 구조화된 패턴은 상품 사실에 맞는 경우에만 사용합니다.
- 없는 변수나 수치를 임의로 채우지 않습니다.
- 브랜드별 세부 문구 규칙은 AGENTS.md에 중복 작성하지 않고 해당 가이드 파일을 기준으로 합니다.

---

## Reference Analysis Rules

레퍼런스 이미지의 상세 분석과 JSON 저장 기능은 유지합니다.

일반적인 저장 위치:

- `data/ad-image-labels.json`

레퍼런스에서 분석할 수 있는 요소:

- hookType
- appealPoint
- copyNuance
- reusableCopyPattern
- whyItWorks
- targetAudience
- visualTone
- layoutPattern
- headlinePosition
- headlineStyle
- imagePattern
- highlightPattern
- pricePattern
- ctaPattern
- copyStructure
- templateFit
- categoryFit

레퍼런스 데이터의 역할:

- 자동 스타일 추천
- 템플릿 추천
- 레이아웃 구조 참고
- 이미지 배치 참고
- 후킹 방향 참고
- 카피 슬롯 구조 참고

레퍼런스 데이터는 업체별 카피 가이드를 대체하지 않습니다.

기본 제작 흐름에서 사용자가 레퍼런스를 직접 선택하지 않아도 됩니다.

직접 선택 기능이 남아 있다면 고급 옵션으로 제공하고 문구 생성의 보조 신호로만 사용합니다.

기존 레퍼런스 분석 데이터와 저장 구조를 삭제하거나 비호환 방식으로 변경하지 않습니다.

---

## Store Analysis Rules

업체 분석 기능은 공개 페이지에서 확인 가능한 정보만 사용합니다.

규칙 기반 코드가 담당할 작업:

- URL 검증
- 플랫폼 감지
- 상품 URL 발견
- 가격 및 할인율 계산
- 리뷰 수와 평점 정리
- 중복 제거
- 품절 처리
- 점수 계산
- 후보군 분류

AI가 담당할 수 있는 작업:

- USP 후보 요약
- 리뷰 반복 패턴 요약
- 콘텐츠 가설 정리
- 추천 이유의 자연어 설명
- 카피 방향 제안

AI가 수치와 상품 사실을 생성하지 않도록 합니다.

업체 분석 결과는 다음 후보군을 지원할 수 있습니다.

- 성과 가능성 높은 상품
- 새롭게 테스트할 상품
- 광고로 재발굴할 상품
- 낮은 우선순위 상품

추천 상품에서 `이 상품으로 제작하기`를 선택하면 기존 상품 제작 흐름으로 전달합니다.

기존 제작 엔진을 별도로 복제하지 않습니다.

---

## Image Selection Rules

`selectedAdImages`는 사용자가 명시적으로 선택한 이미지입니다.

다음 상황에서도 유지해야 합니다.

- 템플릿 변경
- 문구 생성
- 렌더링
- templateCopyMode 변경
- 단일 생성
- 일괄 생성
- 다운로드
- 레퍼런스 또는 추천 스타일 변경

초기화 가능한 경우:

- 새로운 상품 URL을 추출한 경우
- 사용자가 이미지 초기화를 명시적으로 실행한 경우
- 상품 전체 상태를 초기화한 경우

최종 `productImagePaths` 우선순위:

1. selectedAdImages
2. 사용자 업로드 이미지
3. 승인된 생성/가공 이미지
4. source image selection
5. productInfo의 상세 이미지
6. productInfo의 대표 이미지
7. 카테고리에 적합한 안전한 fallback

상품과 무관한 이미지를 fallback으로 사용하지 않습니다.

렌더 API에는 필요에 따라 다음을 전달합니다.

- productImagePaths
- productImagePath
- secondaryProductImagePath

하위 호환성을 유지하되 새 코드는 `productImagePaths`를 우선합니다.

---

## Automatic Design Rules

광고 결과는 실제 집행 가능한 품질을 목표로 합니다.

필수 품질 기준:

- 상품 또는 상세페이지와 어울리는 색상
- 명확한 headline·price·CTA 위계
- 텍스트 잘림 없음
- 글씨와 이미지의 의도하지 않은 겹침 없음
- 상품 핵심 피사체 가림 없음
- 지나치게 작은 글씨 없음
- 템플릿 safe area 준수
- 적합한 short/medium/long variant 선택

자동 디자인 관련 공통 개념:

- extracted palette
- palette policy
- text style preset
- template slots
- text fitting
- image fitting
- collision resolving
- render diagnostics

템플릿 색상을 자동 추출색으로 무조건 덮어쓰지 않습니다.

템플릿은 다음과 같은 palette policy를 가질 수 있습니다.

- full-auto
- accent-only
- protected-palette
- fixed

충돌 해결은 다음 순서를 기본으로 합니다.

1. 줄바꿈 조정
2. 허용 범위 내 폰트 축소
3. 적합한 다른 copy variant 선택
4. 슬롯 내부 위치 미세 조정
5. 낮은 우선순위 장식 축소
6. 낮은 우선순위 장식 숨김
7. 해결되지 않으면 diagnostics 경고

충돌을 숨기고 그대로 렌더하지 않습니다.

---

## Template Rules

템플릿은 새 문구를 생성하지 않습니다.

템플릿은 다음을 정의합니다.

- visual tone
- palette policy
- text style preset
- slots
- safe area
- supported image count
- variant preference
- copy limits
- optimization support

템플릿 변경 시:

- 문구를 새로 생성하지 않습니다.
- selectedAdImages를 초기화하지 않습니다.
- 기존 masterCopy와 copyVariants를 다시 fitting합니다.
- 최종 activeRenderCopy만 다시 계산합니다.

새 템플릿 추가 시:

- 기존 템플릿을 삭제하지 않습니다.
- 단일 렌더링을 유지합니다.
- 일괄 렌더링을 유지합니다.
- activeRenderCopy를 사용합니다.
- productImagePaths를 지원합니다.
- UI에 실제 노출합니다.
- 필요한 copy limits 또는 slots를 정의합니다.
- 테스트 없이 완료로 보고하지 않습니다.

---

## Rendering Rules

단일 렌더링과 일괄 렌더링은 가능한 한 동일한 렌더 파이프라인을 사용합니다.

규칙:

- 렌더 API에는 activeRenderCopy와 productImagePaths를 전달합니다.
- 하나의 템플릿 실패가 전체 일괄 생성 실패로 이어지지 않게 합니다.
- 성공한 결과만 ZIP에 포함합니다.
- 렌더 실패 원인을 UI 또는 diagnostics에서 확인할 수 있게 합니다.
- 기능이 구현되었다면 실제 UI와 결과 이미지에서 확인 가능해야 합니다.
- 아직 새 엔진으로 이전되지 않은 템플릿은 기존 렌더러 fallback을 유지합니다.

---

## Security Rules

외부 URL을 서버에서 가져오는 경우 다음을 지킵니다.

- http/https만 허용
- localhost 차단
- private IP 차단
- 내부망 URL 차단
- file URL 차단
- redirect 이후 URL 재검증
- timeout 적용
- 응답 크기 제한
- content-type 확인
- 동일 도메인 중심 탐색
- 크롤링 깊이 및 페이지 수 제한

차단을 우회하지 않습니다.

환경변수, API key, 내부 경로를 오류 메시지나 로그에 노출하지 않습니다.

---

## Cross-Platform Commands

프로젝트는 Windows와 macOS에서 모두 작업할 수 있습니다.

운영체제에 맞는 명령을 사용합니다.

macOS/Linux:

```bash
npx tsc --noEmit
npm run build
npm run dev


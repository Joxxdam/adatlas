# AdAtlas Codex Instructions

## Project Overview

AdAtlas는 Next.js + TypeScript 기반의 광고 소재 자동화 도구입니다.

이 프로젝트의 주요 목표는 다음과 같습니다.

- 상품 URL에서 상품 정보를 추출합니다.
- 상품 이미지 및 상세페이지 이미지를 수집하고 선택합니다.
- 상품 정보, 레퍼런스 라벨, 브랜드별 카피 가이드를 기반으로 광고 문구를 생성합니다.
- 생성된 문구를 여러 광고 템플릿에 적용합니다.
- 배너 이미지를 렌더링합니다.
- 단일 템플릿 생성과 여러 템플릿 일괄 생성을 지원합니다.

AdAtlas는 단순 이미지 생성기가 아니라, 아래 흐름을 자동화하는 광고 제작 운영 도구입니다.

상품 정보 추출
→ 상세 이미지 후보 수집
→ 광고 이미지 선택
→ 레퍼런스 라벨 선택
→ 브랜드 카피 가이드 매칭
→ 상품 기준 광고 문구 생성
→ 템플릿별 문구 자동 적용
→ 배너 렌더링
→ 다운로드

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

필요한 경우 이미지 다운로드, ZIP 생성, 파일 처리 등을 위한 라이브러리를 추가할 수 있습니다.  
단, 새 라이브러리를 추가할 때는 이유를 명확히 보고해야 합니다.

---

## Important Files

### Main UI

- app/components/MvpDashboard.tsx
  - MVP의 메인 UI입니다.
  - 상품 정보 추출, 이미지 선택, 문구 생성, 템플릿 선택, 렌더링 UI를 담당합니다.

### Copy Generation

- app/api/strategy/generate-copy/route.ts
  - 상품 기준 광고 문구를 생성합니다.
  - masterCopy와 copyVariants를 생성합니다.
  - 상품 정보, 레퍼런스 라벨, 브랜드 카피 가이드를 조합합니다.

- app/lib/mvp/copyPromptBuilder.ts
  - OpenAI 문구 생성을 위한 프롬프트를 구성합니다.
  - 브랜드 카피 가이드, 레퍼런스 라벨, 상품 정보를 통합합니다.

- app/lib/mvp/templateCopyPlanner.ts
  - 템플릿별 문구를 계산합니다.
  - short / medium / long 문구 variant 중 적합한 것을 선택합니다.
  - 최종 렌더링용 activeRenderCopy를 생성합니다.

- app/lib/mvp/templateCopyFitter.ts
  - 템플릿별 글자 수 제한에 맞게 문구를 보정합니다.
  - 문구가 넘칠 때 안전하게 축약합니다.

### Image Selection

- app/lib/mvp/imageSelectionResolver.ts
  - 렌더링에 사용할 최종 productImagePaths를 계산합니다.
  - 사용자가 선택한 selectedAdImages를 최우선으로 사용합니다.

### Rendering

- app/api/render/template-ad/route.ts
  - 선택된 템플릿을 이미지로 렌더링합니다.
  - 단일 렌더링과 일괄 렌더링에서 공통으로 사용될 수 있습니다.

### Brand Copy Guides

- data/copy-guides/*.md
  - 브랜드별 카피 가이드입니다.

- data/copy-guides/index.json
  - 광고주/브랜드/도메인을 카피 가이드와 연결합니다.

### Reference Labels

- data/ad-image-labels.json
  - 광고 레퍼런스 이미지 분석 결과를 저장합니다.
  - 후킹 방식, 소구점, 문구 톤, 레이아웃 패턴 등을 포함합니다.

---

## Core Concepts

### masterCopy

masterCopy는 상품 기준으로 생성된 기본 광고 문구입니다.

중요 규칙:

- 특정 템플릿 하나에 종속되면 안 됩니다.
- 상품 정보, 레퍼런스 라벨, 브랜드 카피 가이드를 조합해서 생성합니다.
- 템플릿을 변경해도 masterCopy를 다시 생성하지 않습니다.
- 템플릿은 masterCopy를 기반으로 적합한 길이의 문구를 선택할 뿐입니다.

---

### copyVariants

copyVariants는 템플릿별 문구 길이에 대응하기 위한 문구 세트입니다.

필수 variant:

- short
- medium
- long

각 variant는 단순히 긴 문구를 자른 결과가 아니어야 합니다.  
각 길이에 맞게 자연스럽고 광고 문구답게 작성되어야 합니다.

기준:

- short: 좁은 템플릿, 문구 공간이 작은 템플릿
- medium: 일반적인 템플릿
- long: 문구 공간이 넓은 템플릿

---

### activeRenderCopy

activeRenderCopy는 실제로 렌더 API에 전달되는 최종 문구입니다.

계산 기준:

masterCopy
+ selectedTemplate
+ templateCopyMode
+ selected template copyLimits
→ activeRenderCopy

중요 규칙:

- 렌더 API에는 원칙적으로 activeRenderCopy를 전달합니다.
- masterCopy를 그대로 렌더 API에 직접 보내면 안 됩니다.
- 단, templateCopyMode = "original"인 경우에만 원문 사용을 허용할 수 있습니다.

---

### templateCopyMode

템플릿별 문구 적용 방식입니다.

기본값:

templateCopyMode = "auto-variant"

허용 모드:

- original
  - masterCopy 원문을 그대로 사용합니다.
  - 문구가 넘칠 수 있으므로 preview에서 overflow를 표시해야 합니다.

- auto-variant
  - 기본 모드입니다.
  - 템플릿 길이에 맞게 short / medium / long 중 적합한 문구를 자동 선택합니다.

- force-fit
  - masterCopy 원문을 기준으로 fitCopyToTemplate을 강제 적용합니다.

---

### selectedAdImages

selectedAdImages는 사용자가 명시적으로 선택한 상품/상세페이지 이미지입니다.

아래 상황에서도 반드시 유지되어야 합니다.

- 템플릿 변경
- 문구 생성
- 렌더링 실행
- templateCopyMode 변경
- 일괄 생성
- 다운로드

초기화하면 안 되는 경우:

- 템플릿만 변경한 경우
- 문구만 다시 생성한 경우
- 렌더링만 실행한 경우
- 일괄 생성만 실행한 경우
- 레퍼런스 라벨만 변경한 경우

초기화 가능한 경우:

- 새 상품 URL을 추출한 경우
- 사용자가 직접 이미지 선택 초기화 버튼을 누른 경우
- 상품 정보 전체를 초기화한 경우

---

### productImagePaths

productImagePaths는 렌더 API에 전달되는 최종 이미지 배열입니다.

중요 규칙:

- 항상 selectedAdImages를 가장 우선으로 사용합니다.
- 단일 이미지뿐 아니라 2~4장 이미지 배열을 지원해야 합니다.
- productImagePath, secondaryProductImagePath도 하위 호환성을 위해 함께 전달할 수 있습니다.

렌더 API에 전달해야 하는 이미지 필드:

- productImagePaths
- productImagePath
- secondaryProductImagePath

---

## Copy Generation Rules

AdAtlas의 문구 생성은 아래 우선순위를 따릅니다.

1. productInfo
   - 상품명, 가격, 할인율, 카테고리, 상세 설명 등 사실 정보의 기준입니다.
   - 허위 가격, 허위 혜택, 없는 속성을 만들어내면 안 됩니다.

2. brand copyGuide
   - 광고주/브랜드의 톤앤매너, 문구 구조, 자주 쓰는 표현 방식을 정의합니다.
   - 최종 문구가 아니라 참고 가이드입니다.

3. referenceLabels
   - 이번 소재에서 참고할 후킹 방식, 소구점, 카피 뉘앙스, 레이아웃 패턴입니다.
   - 브랜드 가이드보다 “이번 소재의 방향성”에 가깝습니다.

4. template copyLimits
   - 문구를 새로 생성하는 기준이 아니라, 이미 생성된 문구를 어느 길이로 적용할지 결정하는 기준입니다.

문구 생성 흐름:

productInfo
+ selected referenceLabels
+ matched brand copyGuide
→ masterCopy
→ copyVariants.short / medium / long
→ templateCopyPlanner
→ activeRenderCopy
→ render API

중요 규칙:

- 템플릿만 변경했을 때 완전히 새로운 문구를 생성하지 마세요.
- 템플릿 변경 시에는 기존 masterCopy에서 적합한 variant를 선택하세요.
- 문구 생성 API는 특정 템플릿 하나에 종속되면 안 됩니다.
- 템플릿은 문구 길이와 배치만 결정해야 합니다.
- 상품 정보에 없는 가격, 등급, 수량, 리뷰 수, 할인율을 임의로 만들면 안 됩니다.

---

## Brand Copy Guide Rules

브랜드별 카피 가이드는 아래 경로에 저장합니다.

- data/copy-guides/*.md
- data/copy-guides/index.json

브랜드 카피 가이드는 아래 기준으로 매칭합니다.

- advertiserName
- brandName
- productUrl domain
- productName
- aliases

중요 규칙:

- 브랜드 카피 가이드는 최종 문구가 아닙니다.
- 예시 문구를 그대로 복붙하지 마세요.
- 상품 정보에 맞게 자연스럽게 변형해서 사용하세요.
- 상품에 없는 가격, 등급, 할인율, 수량, 리뷰 수를 임의로 만들면 안 됩니다.
- 가격 정보는 productInfo를 우선으로 사용합니다.

---

## 국대한우 Copy Guide Rules

국대한우 카피는 강한 구어체, 가격 충격, 선물/가족/모임 맥락, 희소성, 사회적 증거를 중심으로 구성합니다.

국대한우 가이드의 주요 역할:

- 헤드라인 후보군
- 서브카피 구조
- 가격 앵커링
- 긴급성/희소성
- 사회적 증거
- 선물/모임 프레이밍
- 품질/신뢰 강조
- CTA

특히 아래 섹션은 모두 headline 또는 headlineVariants 후보군으로 봅니다.

- 기본 가격/선물 후킹형
- 내부자 고백 / 사장님 결단형
- 전문가 / 권위 인용형
- 놀람 / 반전형

중요 규칙:

- “내부자 고백 / 사장님 결단”
- “전문가/권위 인용”
- “놀람/반전”

위 계열 문구는 주로 headline 또는 headlineVariants에 사용합니다.

아래와 같은 헤드라인성 문구를 bodyCopy, bottomBarCopy, cta에 길게 넣지 마세요.

예:

- 사장님이 미쳤어요
- 이 가격 보고 저도 두 번 놀랐습니다
- 담당자 컨펌 없이 그냥 올렸습니다
- 정육점 사장님들이 이 글 보면 화낼 가격

슬롯별 권장 역할:

headline
= 강한 후킹 문구
= 내부자 고백/가격 충격/반전/선물 후킹

bodyCopy
= 상품 설명, 품질 특징, 용도, 구성 설명

highlightCopy
= 파격특가, 오늘만 특가, 품절임박, 리뷰폭발 같은 짧은 라벨

bottomBarCopy
= 기존가, 할인가, 가격 앵커링, 보조 가격 문구

cta
= 지금 구매하기, 특가 확인, 지금 담기 같은 짧은 행동 유도

---

## Reference Label Rules

레퍼런스 라벨은 아래 파일에 저장합니다.

- data/ad-image-labels.json

레퍼런스 라벨은 아래 요소를 이해하기 위해 사용합니다.

- hookType
- appealPoint
- copyNuance
- layoutPattern
- reusableCopyPattern
- whyItWorks
- targetAudience
- visualTone

문구 생성 시 역할:

productInfo
= 사실 정보

brand copyGuide
= 브랜드/광고주의 고정 톤앤매너

referenceLabels
= 이번 소재에서 참고할 후킹 방향과 크리에이티브 구조

중요 규칙:

- 레퍼런스 라벨 구조를 삭제하거나 덮어쓰지 마세요.
- 레퍼런스 문구를 그대로 복붙하지 마세요.
- 레퍼런스의 구조와 소구점을 참고해 새로운 문구를 생성하세요.
- 기존 referenceLabels 로직은 반드시 유지하세요.

---

## Template Rules

템플릿은 새 문구를 생성하지 않습니다.

템플릿은 아래 문구 중 적합한 것을 선택하고, 필요 시 길이를 보정합니다.

- masterCopy
- copyVariants.short
- copyVariants.medium
- copyVariants.long

기본 모드:

templateCopyMode = "auto-variant"

적용 규칙:

- 템플릿에 문구 공간이 충분하면 long을 사용합니다.
- 일반 템플릿에는 medium을 사용합니다.
- 좁거나 복잡한 템플릿에는 short를 사용합니다.
- short도 넘치면 fitCopyToTemplate을 사용합니다.
- 가격은 가능하면 productInfo.price를 유지합니다.
- CTA는 짧고 명확해야 합니다.

렌더 API로 보내는 최종 문구는 반드시 activeRenderCopy여야 합니다.

예외:

- templateCopyMode = "original"인 경우에만 masterCopy 원문을 사용할 수 있습니다.
- 이 경우에도 overflow preview를 표시해야 합니다.

템플릿을 새로 추가할 때는 반드시 다음을 지켜야 합니다.

- 기존 템플릿을 삭제하지 않습니다.
- 기존 단일 렌더링 흐름을 깨지 않습니다.
- 기존 일괄 렌더링 흐름을 깨지 않습니다.
- copyLimits를 추가합니다.
- activeRenderCopy를 사용합니다.
- productImagePaths를 지원합니다.
- UI 템플릿 목록에 노출되게 합니다.

---

## Image Selection Rules

selectedAdImages는 사용자가 직접 선택한 이미지입니다.

아래 상황에서도 유지되어야 합니다.

- 템플릿 변경
- 문구 생성
- 렌더링 실행
- templateCopyMode 변경
- 일괄 생성
- 다운로드

렌더링 전에는 반드시 imageSelectionResolver를 통해 최종 이미지를 계산하세요.

이미지 우선순위:

1. selectedAdImages
2. 업로드 이미지
3. GPT 생성 이미지
4. sourceImageSelection
5. productInfo.productImagePaths
6. productInfo.productImagePath
7. fallback image

렌더 API에는 가능한 한 아래 값을 모두 전달하세요.

- productImagePaths
- productImagePath
- secondaryProductImagePath

중요 규칙:

- 템플릿 변경 시 selectedAdImages를 초기화하지 마세요.
- 문구 생성 시 selectedAdImages를 초기화하지 마세요.
- 렌더링 실행 시 selectedAdImages를 초기화하지 마세요.
- 일괄 생성 시 모든 템플릿에 동일한 selectedAdImages를 사용하세요.

---

## Rendering Rules

렌더링 기능을 수정할 때는 아래 원칙을 지키세요.

- 기존 단일 렌더링 기능을 유지합니다.
- 기존 일괄 렌더링 기능이 있다면 유지합니다.
- 렌더 API에는 activeRenderCopy와 productImagePaths를 전달합니다.
- 렌더링 실패 시 사용자에게 원인을 알 수 있는 메시지를 표시합니다.
- 하나의 템플릿 실패가 전체 일괄 생성 실패로 이어지지 않게 합니다.
- 성공한 결과만 다운로드 또는 ZIP에 포함합니다.
- 기능이 구현되었다면 반드시 UI에서 확인 가능해야 합니다.

---

## Do Not Do

다음 작업은 하지 마세요.

- 명시적으로 요청받지 않은 템플릿 시각 디자인 수정
- 기존 단일 템플릿 렌더링 흐름 제거
- 기존 일괄 템플릿 렌더링 흐름 제거
- 기존 referenceLabels 로직 제거
- 기존 copy guide 로직 제거
- AGENTS.md 지침과 충돌하는 대규모 리팩토링
- .env.local 커밋
- API key 하드코딩
- 생성된 이미지 파일 커밋
- 로그 파일 커밋
- 템플릿 변경 시 selectedAdImages 초기화
- 템플릿만 변경했는데 문구를 다시 생성하는 동작
- UI에 보이지 않는 기능을 완료됐다고 보고하는 것
- 타입 에러가 있는데 완료됐다고 보고하는 것

---

## Required Validation

코드 변경 후 아래 명령을 실행하세요.

npx.cmd tsc --noEmit

필요한 경우 아래 명령도 실행하세요.

npm.cmd run build

새 기능을 추가한 경우 아래를 확인하세요.

- 관련 UI가 실제 화면에 보이는지
- 기존 단일 렌더링이 깨지지 않았는지
- 기존 일괄 렌더링이 깨지지 않았는지
- selectedAdImages가 유지되는지
- masterCopy → copyVariants → activeRenderCopy 흐름이 유지되는지
- productImagePaths가 렌더 API에 전달되는지

검증 기준:

- 타입 체크가 실패하면 완료가 아닙니다.
- UI에 기능이 보이지 않으면 완료가 아닙니다.
- 기존 핵심 기능이 깨졌다면 완료가 아닙니다.

---

## Git Hygiene

다음 파일은 커밋하지 마세요.

- .env
- .env.local
- *.log
- .next
- 생성된 이미지 파일
- 임시 테스트 파일
- 로컬 캐시 파일

생성 이미지 폴더는 필요할 경우 .gitkeep만 남기고, 실제 생성물은 Git에 포함하지 마세요.

예시:

- public/generated-ads/.gitkeep
- public/generated-product-images/.gitkeep
- public/processed-products/.gitkeep

---

## Commit / Push Guidelines

Codex는 사용자가 명시적으로 요청하지 않는 한 자동으로 커밋하거나 푸시하지 마세요.

작업 완료 후에는 아래 정보를 보고하세요.

- 수정한 파일
- 추가한 파일
- 삭제한 파일
- 실행한 검증 명령
- 타입 체크 결과
- 빌드 결과
- 남은 문제
- 사용자가 직접 확인해야 할 UI 위치

---

## Reporting Format

작업 완료 후 아래 형식으로 보고하세요.

- 수정한 파일:
- 추가한 파일:
- 삭제한 파일:
- 핵심 변경 내용:
- UI에 추가된 기능:
- 유지한 기존 기능:
- 실행한 검증 명령:
- 타입 체크 결과:
- 빌드 결과:
- 남은 문제:
- 사용자가 확인해야 할 화면 위치:
- 주의할 점:

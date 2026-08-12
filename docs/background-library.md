# AdAtlas 배경 라이브러리

## 목적

상품 URL마다 배경 생성을 기다리지 않고, 검수된 공용 배경을 상품·후킹·타깃에 맞춰 추천해 1200×1200 광고를 빠르게 합성한다. 기본 제작 흐름은 `상품 분석 → 후킹 3안 → 후킹 선택 → 배경 6안 → 배경 선택 → 적응형 레이아웃 3안 → 편집·생성`이다. AI 생성은 공용 자산을 미리 만들고 검수하는 관리 작업에만 사용한다.

## 구조

배경은 `public/background-library/<category>/`에 최적화된 WebP만 저장한다. 기본 대분류는 `fashion`, `beauty`, `health`, `agriculture`, `meat`, `seafood`, `processed-food`, `food-mall`, `living`, `kids`, `pet`, `promotion`이다. 새 대분류는 관리 화면에서 영문 소문자·숫자·하이픈 이름으로 추가한다. 세부 구분은 폴더가 아닌 `subcategories`, `industries`, `mood`, `elements`, `colors` 태그로 관리한다.

- 다운로드·생성 원본 정의: `data/background-library-manifest.json`
- 실제 사용 메타데이터: `data/background-library.json`
- 카테고리 목록: `data/background-library-categories.json`
- AI 일괄 생성 프롬프트: `data/background-generation-prompts.json`
- 검증 결과: `data/background-library-validation.json`
- 검수 이미지: `docs/background-library-contact-sheets/`

`lifestyle_photo`, `people_photo`는 실제 공간·상황을 보여주는 실사형이다. `product_set`, `pattern_texture`, `ingredient_scene`, `ai_generated`, `designed_asset`는 상품 누끼 합성을 고려한 콘텐츠형이다. `user_uploaded`는 관리 화면에서 추가한 자산이다.

## 명령

```bash
npm run backgrounds:download
npm run backgrounds:generate -- --dry-run
npm run backgrounds:verify
npm run backgrounds:contact-sheet
```

특정 카테고리나 ID만 다시 처리할 수 있다.

```bash
node scripts/download-background-library.mjs --category beauty
node scripts/download-background-library.mjs --id beauty-01 --force
node scripts/generate-background-library.mjs --category beauty --limit 2
```

다운로드 스크립트는 정상 파일을 건너뛰고 HTTP·Content-Type·이미지 열기·최소 해상도를 검사한 뒤 정사각형 WebP로 만든다. SHA-256과 perceptual hash로 동일·유사 자산을 검사하며, 일부 실패가 있어도 나머지를 계속 처리한다. 생성 스크립트는 환경변수의 OpenAI 키를 사용하며 키를 코드에 저장하지 않는다. 생성 결과는 `reviewed: false` 상태로 두고 시각 검수 후에만 활성화한다.

## manifest 작성과 출처

각 항목에는 ID, 파일 경로, category, subcategories, industries, assetType, hookTypes, ageGroups, peopleType, 인물 위치·행동, scene, mood, elements, colors, productPosition, textSafeArea, 밝기·대비를 기록한다.

스톡 이미지는 `sourceName`, 공식 `sourcePageUrl`, 실제 `originalImageUrl`, `licenseUrl`, `authorName`, `downloadedAt`을 기록한다. AI 자산은 `generationModel`, 전체 `generationPrompt`, `generatedAt`, `reviewed`를 기록한다. 직접 제작 자산은 `designMethod`와 `createdAt`, 업로드 자산은 `uploadedAt`을 기록한다. 라이선스가 불명확한 파일은 등록하지 않는다.

## 관리 화면

`카테고리 관리 > 배경 라이브러리 관리`에서 다음을 수행한다.

- 카테고리·세부 카테고리·연령·인물·실사/콘텐츠 유형·태그 필터
- 이미지 미리보기와 출처·라이선스 확인
- 배경 업로드, 장면·태그 수정, 활성화/비활성화, 삭제
- 새 카테고리 추가

업로드 API는 20MB 이하 PNG/JPEG/WebP/AVIF만 받고, 경로 조작을 차단한 고유 파일명으로 `background-library` 내부에만 저장한다. 짧은 변 800px 미만은 거부하고 1600×1600 WebP로 변환하며 EXIF는 복사하지 않는다. 파일 누락·로딩 실패 카드는 제외되며 나머지 UI는 유지된다. AI 생성 화면에서 보관한 자산도 같은 메타데이터 저장소에 들어간다.

## 추천과 자동 레이아웃

추천 점수는 대분류, 세부 카테고리, 업종, 후킹, 연령, 자산 유형, 장면·분위기·요소, 선호 색상, 문구 안전 영역, 상품 위치, 인물 필요 여부와 모델 포함 여부를 합산한다. 기본 6안은 이 적합도와 별도로 자산 유형·장면·인물·연령·색상·문구 위치·상품 위치·명암·perceptual hash의 반복을 감점하는 다양성 재정렬을 거친다. 같은 파일은 한 번만 추천하며 `다른 배경 추천`은 최근 72개와 현재 세션에서 선택한 ID를 제외하거나 감점한다. 부족하면 동일 대분류, 유사 업종, promotion 순서로 확장한다.

선택 배경의 `textSafeArea`, `productPosition`, `focalArea`, 인물 위치, 접지면, assetType, 명암, 추출 팔레트, 상품 누끼 비율과 후킹·가격·CTA 유무를 이용해 14개 레이아웃 유형 중 적합한 3개만 만든다. 카피·상품·콘텐츠 강조형은 서로 다른 위계와 좌표를 사용한다. 배경을 바꾸면 이 분석과 색상 대비를 다시 계산하되 사용자가 작성한 문구와 상품 정보는 유지한다. 상품 누끼에는 기본적으로 자연스러운 접지 그림자만 주고, 프로모션·패턴형에서만 약한 외곽선을 허용한다.

여러 시안 생성의 기본 모드는 서로 다른 배경 3개를 쓰는 `다양한 배경으로 생성`이다. 필요할 때만 `선택한 배경으로 비교`로 한 배경의 레이아웃 3개를 만들거나 `후킹별로 생성`으로 후킹·배경·레이아웃을 각각 바꾼다. 선택 시안은 상품·문구·배경 위치와 크기, 색상, 가격·CTA 표시, 그림자, 배경 밝기·흐림·확대·이동을 수정할 수 있고 `자동 배치로 되돌리기`로 분석 당시 값을 복원한다.

## 품질 기준과 검수

정상 자산은 WebP, 정사각형, 최소 1200×1200, 가급적 1MB 이하여야 한다. 단색·단순 그라데이션, 다른 브랜드 제품·로고·문구·가격·워터마크, 중앙을 차지한 기존 상품, 깨진 파일, 합성 여백이 없는 복잡한 사진, 부자연스러운 AI 인물은 제외한다.

`npm run backgrounds:verify` 후 카테고리별 contact sheet와 필요 시 개별 이미지를 열어 인물·손·얼굴, 로고·글자, 접지면, 카피 여백, 중복 구도를 확인한다. 사용자 업로드나 AI 자산을 운영용 manifest에 영구 편입하려면 관리 화면에서 검수한 최종 메타데이터를 manifest에도 반영한다.

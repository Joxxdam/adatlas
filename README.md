This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# AdAtlas

AdAtlas는 광고 이미지 레퍼런스를 수집하고, 이미지별 후킹 방식·소구점·카피 뉘앙스·레이아웃 패턴을 라벨링한 뒤, 축적된 라벨 데이터를 기반으로 광고 문구와 배너를 자동 생성하는 내부 실무용 광고 크리에이티브 툴입니다.

현재 목표는 단순 이미지 수집기가 아니라, 한국 이커머스 퍼포먼스 광고의 “왜 이 문구가 먹히는지”를 라벨 데이터로 축적하고, 이를 바탕으로 상품별 광고 소재를 빠르게 생성하는 것입니다.

---

## 프로젝트 목표

최종 목표 흐름은 아래와 같습니다.

```text
광고 이미지 수집
→ 이미지별 AI 1차 분석
→ 사용자가 라벨 수정/저장
→ 라벨 데이터 축적
→ 상품 정보 입력
→ 저장된 라벨 데이터를 참고해 광고문구 생성
→ Canvas/SVG 템플릿으로 광고 배너 생성
→ 1200x1200 PNG 다운로드
```

---

## 핵심 방향

AdAtlas는 브랜드 중심 수집 툴이 아니라, 아래 기준으로 광고 이미지를 분석합니다.

```text
카테고리
후킹 유형
소구점
카피 뉘앙스
타깃 감정
시각 톤
레이아웃 패턴
왜 이 광고가 먹히는지
어떤 상품에 재활용 가능한지
```

현재는 파인튜닝 단계가 아닙니다.
먼저 라벨 데이터베이스를 만들고, 저장된 라벨을 참고하여 광고문구와 배너를 생성하는 구조로 개발합니다.

나중에 라벨 데이터가 충분히 쌓이면 Qwen2.5-VL 같은 오픈소스 VLM 파인튜닝을 검토할 수 있습니다.

---

## 기술 스택

```text
Next.js
TypeScript
React
OpenAI API
Canvas/SVG
sharp
JSON file storage
```

현재는 별도 DB 없이 `data` 폴더의 JSON 파일을 사용합니다.

---

## 실행 방법

패키지 설치:

```bash
npm install
```

개발 서버 실행:

```bash
npm run dev
```

브라우저 접속:

```text
http://localhost:3000
```

---

## 환경 변수 설정

OpenAI API를 사용하려면 프로젝트 루트에 `.env.local` 파일을 만들고 아래 값을 넣습니다.

```env
OPENAI_API_KEY=sk-...
```

주의:

```text
.env.local은 절대 GitHub에 올리면 안 됩니다.
NEXT_PUBLIC_OPENAI_API_KEY를 사용하지 않습니다.
OpenAI API Key는 서버 API route에서만 사용합니다.
```

`.gitignore`에는 아래 항목이 포함되어야 합니다.

```gitignore
.env*
.env
.env.local
.env.production
```

---

## 현재 구현 기능

### 1. 광고 이미지 수집/표시

`public/collected-images` 폴더에 저장된 광고 이미지를 불러와 카드 형태로 보여줍니다.

관련 파일:

```text
public/collected-images
data/collected-ad-images.json
app/api/collected-images/route.ts
app/lib/mvp/collectedImageStore.ts
```

---

### 2. 광고 이미지 AI 분석

각 광고 이미지에 대해 AI 분석을 실행할 수 있습니다.

분석 결과는 아래 항목을 포함합니다.

```text
OCR 텍스트
카테고리
후킹 유형
소구점
타깃 감정
카피 뉘앙스
시각 톤
레이아웃 패턴
왜 먹히는지
추천 활용 방식
```

관련 파일:

```text
app/api/analyze/ad-image/route.ts
```

OpenAI API 키가 없거나 quota/rate limit 문제가 있으면 앱이 멈추지 않고 mock 결과를 반환하거나 사용자에게 안내해야 합니다.

---

### 3. 라벨 저장

AI 분석 결과는 초안입니다.
최종 데이터는 사용자가 수정한 `finalLabel`입니다.

라벨은 `data/ad-image-labels.json`에 저장됩니다.

관련 파일:

```text
data/ad-image-labels.json
app/api/labels/ad-image/route.ts
app/lib/mvp/labelStore.ts
```

라벨 구조 예시:

```json
{
  "imageId": "",
  "category": "",
  "brandName": "",
  "sourcePlatform": "",
  "localImagePath": "",
  "aiDraft": {
    "ocrText": "",
    "category": "",
    "hookType": "",
    "appealPoint": "",
    "targetEmotion": "",
    "copyNuance": "",
    "visualTone": "",
    "layoutPattern": "",
    "whyItWorks": "",
    "recommendedUse": ""
  },
  "finalLabel": {
    "ocrText": "",
    "category": "",
    "hookType": "",
    "appealPoint": "",
    "targetEmotion": "",
    "copyNuance": "",
    "visualTone": "",
    "layoutPattern": "",
    "whyItWorks": "",
    "recommendedUse": ""
  },
  "labeledAt": "ISO_DATE"
}
```

---

## 기본 라벨 옵션

### 카테고리

```json
[
  "식품/선물",
  "뷰티/스킨케어",
  "패션/의류",
  "생활용품",
  "건강기능식품",
  "디지털/앱",
  "인테리어/리빙",
  "기타"
]
```

### 후킹 유형

```json
[
  "가격정당화형",
  "가격소구형",
  "문제제기형",
  "공감형",
  "후기/리뷰형",
  "UGC형",
  "비포애프터형",
  "전문가/권위형",
  "선물명분형",
  "긴급/한정형",
  "반전/궁금증형",
  "상황제안형"
]
```

### 소구점

```json
[
  "가성비",
  "선물명분",
  "고급감",
  "실속",
  "불편해소",
  "체형보완",
  "성분/효능",
  "시간절약",
  "후기신뢰",
  "희소성",
  "즉시혜택",
  "자기관리",
  "사회적 인정"
]
```

---

## 광고문구 생성 기능

라벨 완료된 광고 데이터를 참고하여 새 상품에 맞는 광고문구를 생성합니다.

관련 API:

```text
app/api/strategy/generate-copy/route.ts
```

입력값 예시:

```json
{
  "productInfo": {
    "productName": "",
    "category": "",
    "price": "",
    "discountInfo": "",
    "mainBenefit": "",
    "targetCustomer": "",
    "landingUrl": "",
    "productImagePath": "",
    "backgroundImagePath": ""
  },
  "referenceLabels": []
}
```

출력값 예시:

```json
{
  "headline": "",
  "bodyCopy": "",
  "highlightCopy": "",
  "bottomBarCopy": "",
  "cta": "",
  "price": "",
  "hookType": "",
  "appealPoint": "",
  "whyThisWorks": ""
}
```

문구 생성 원칙:

```text
기존 레퍼런스 문구를 그대로 복사하지 않습니다.
라벨 데이터의 구조와 뉘앙스만 참고합니다.
한국 이커머스 퍼포먼스 광고 톤으로 작성합니다.
“할인 중입니다” 같은 일반적인 문구는 피합니다.
가격정당화, 선물명분, 문제제기, 후기형, 공감형, 긴급특가형 등의 의도를 반영합니다.
```

---

## Canvas/SVG 배너 생성 기능

AdAtlas는 Canva API가 아니라 내부 Canvas/SVG 기반 렌더링 방식으로 광고 배너를 생성합니다.

목표:

```text
상품 정보
+ 상품 이미지
+ 배경 이미지
+ 생성된 광고문구
+ 템플릿
+ 색상/폰트 스타일
= 1200x1200 PNG 배너
```

관련 API:

```text
app/api/render/template-ad/route.ts
```

생성 결과 저장 위치:

```text
public/generated-ads
```

---

## 상품 이미지 업로드

상품 이미지는 아래 폴더에 저장합니다.

```text
public/product-images
```

업로드 API:

```text
app/api/upload/product-image/route.ts
```

지원 형식:

```text
png
jpg
jpeg
webp
```

투명 PNG를 사용하면 상품 외곽선/그림자 효과를 자연스럽게 적용할 수 있습니다.

---

## 배경 이미지 업로드

배경 이미지는 아래 폴더에 저장합니다.

```text
public/background-images
```

업로드 API:

```text
app/api/upload/background-image/route.ts
```

배경 이미지 처리 방식:

```text
1200x1200 캔버스 전체에 cover 방식 배치
비율 유지
중앙 기준 crop
blur 적용 가능
dark overlay 적용 가능
opacity 조절 가능
```

---

## 상품 외곽선/그림자 효과

투명 PNG 상품 이미지일 경우 알파 채널 기준으로 상품 모양을 따라 외곽선과 그림자를 적용합니다.

옵션 예시:

```json
{
  "productEffect": {
    "outline": true,
    "outlineColor": "#ffffff",
    "outlineWidth": 10,
    "shadow": true,
    "shadowColor": "rgba(0,0,0,0.35)",
    "shadowBlur": 18,
    "shadowOffsetX": 0,
    "shadowOffsetY": 8
  }
}
```

주의:

```text
Canvas/SVG는 상품 이미지를 자동으로 누끼 따는 기능이 아닙니다.
이미 누끼가 따진 투명 PNG에 테두리와 그림자를 적용하는 기능입니다.
자동 누끼 제거는 `REMOVE_BG_API_KEY`가 설정된 경우 remove.bg API로 처리하며, 결과 PNG는 `public/processed-products`에 저장됩니다.
```

---

## 배너 템플릿 10종

템플릿 설정 파일:

```text
lib/bannerTemplates.ts
```

각 템플릿은 레이아웃뿐 아니라 색감, 폰트 스타일, 강조 박스, CTA 스타일을 포함합니다.

### 1. shock-headline-001

감탄 후킹형

```text
용도: 식품, 특가, 신제품, 후기형 광고
스타일: 흰 배경, 빨강 headline, 노란 강조 박스, 빨간 하단 바, CTA 연한 레드
```

### 2. price-proof-002

가격정당화형

```text
용도: 한우, 선물세트, 식품, 공구 상품
스타일: 빨강/노랑/검정, 가격 크게, 정상가 취소선, 할인가 강조
```

### 3. review-reaction-003

후기 반응형

```text
용도: 앱, 뷰티, 생활용품, UGC형 광고
스타일: 후기 카드, 말풍선, 밝은 회색/화이트, 자연스러운 굵기
```

### 4. problem-solution-004

문제제기 해결형

```text
용도: 뷰티, 건강식품, 기능성 제품
스타일: 문제 문구 강한 색상, 해결 문구 안정감 있는 색상, pill 태그
```

### 5. ugc-meme-005

밈/공감형

```text
용도: 건강식품, 간식, MZ 타깃
스타일: 짤 느낌, 큰 문구, 외곽선/그림자 텍스트
```

### 6. premium-gift-006

선물명분 고급감형

```text
용도: 한우, 과일세트, 화장품, 명절/부모님 선물
스타일: 블랙/딥브라운/골드, 고급감, 과한 형광색 금지
```

### 7. benefit-tags-007

기능 태그형

```text
용도: 뷰티, 스킨케어, 건강기능식품
스타일: 민트/블루/라벤더/베이지, 원형/캡슐형 효능 태그
```

### 8. lifestyle-scene-008

상황 제안형

```text
용도: 패션, 리빙, 식품, 캠핑/여행
스타일: 배경 이미지 활용, 반투명 텍스트 박스, 감성적이지만 전환형
```

### 9. comparison-before-after-009

비교 전후형

```text
용도: 앱, 정리 서비스, 뷰티, 생활 개선 상품
스타일: 좌우 분할, Before 회색/어두운 톤, After 밝은 톤, VS/화살표 요소
```

### 10. home-shopping-max-010

홈쇼핑 강전환형

```text
용도: 공구, 특가, 식품, 생활용품, 긴급 프로모션
스타일: 빨강/노랑/검정 고대비, 매우 굵은 글씨, 혜택 박스 여러 개
```

---

## 스타일 조정 기능

광고 생성 섹션에서 아래 스타일을 조정할 수 있습니다.

```text
backgroundColor
headlineColor
highlightBackground
bottomBarColor
ctaBarColor
headlineFontSize
bodyFontSize
highlightFontSize
priceFontSize
backgroundBlur
backgroundDarkOverlay
backgroundOpacity
textShadow
textStroke
product outline
product outline color
product outline width
product shadow
product shadow strength
```

기본은 템플릿 스타일을 사용하고, 사용자가 수정한 값만 `styleOverrides`로 전달합니다.

---

## 프론트 광고 생성 흐름

광고 생성 섹션의 목표 흐름:

```text
1. 상품 정보 입력
2. 상품 이미지 업로드
3. 배경 이미지 업로드
4. 라벨 완료된 레퍼런스 1~3개 선택
5. 광고문구 생성
6. 생성된 문구 수정
7. 템플릿 10종 중 선택
8. 색감/글씨 크기/배경/테두리 효과 조정
9. 배너 생성
10. 1200x1200 PNG 미리보기
11. PNG 다운로드
```

---

## 비용 관리

OpenAI API는 아래 기능에서만 호출합니다.

```text
AI 이미지 분석
광고문구 생성
```

아래 기능에서는 OpenAI API를 호출하지 않습니다.

```text
템플릿 선택
색상 변경
폰트 크기 변경
Canvas/SVG 배너 생성
PNG 다운로드
```

---

## 현재 단계에서 하지 않는 것

아래 기능은 현재 단계에서 구현하지 않습니다.

```text
Canva API 연동
Figma API 연동
GPT 이미지 API 호출
ComfyUI 연결
상품 URL 자동 추출
자동 크롤링 수정
Qwen 파인튜닝
자동 누끼 제거
유료 폰트 파일 추가
```

---

## Git 주의사항

절대 커밋하면 안 되는 파일:

```text
.env
.env.local
.env.production
```

생성 결과물 폴더는 Git에 올리지 않는 것을 권장합니다.

```gitignore
public/generated-ads/*
!public/generated-ads/.gitkeep
```

---

## 커밋 예시

```bash
git add .
git status
git commit -m "feat: implement ad image labeling and banner generation"
git push
```

커밋 전 반드시 확인:

```text
.env.local이 git status에 나오면 커밋하지 말 것
Changes not staged for commit이 남아있으면 git add . 다시 실행
```

---

## 앞으로의 개발 우선순위

1. 광고 이미지 라벨링 안정화
2. finalLabel 기반 문구 생성 정확도 개선
3. 상품 이미지/배경 이미지 업로드 안정화
4. Canvas/SVG 템플릿 10종 완성
5. 스타일 조정 패널 개선
6. PNG 생성 품질 개선
7. 라벨 데이터가 충분히 쌓인 뒤 파인튜닝 검토

import assert from "node:assert/strict";
import test from "node:test";

import {
  isPrivateIpAddress,
  isSameStoreDomain,
  safeFetchHtml,
  validatePublicHttpUrl,
} from "../app/lib/store-analysis/urlSafety.ts";
import { selectDiverseSiteCandidates } from "../app/lib/site-candidates/diversity.ts";
import {
  deduplicateProductUrls,
  detectSitePageType,
  normalizeSitePageUrl,
} from "../app/lib/site-candidates/pageClassifier.ts";
import { extractSiteProductRecord } from "../app/lib/site-candidates/productSignals.ts";
import {
  buildSiteAdCandidate,
  evidenceLevelForProduct,
  exclusionReasons,
} from "../app/lib/site-candidates/scoring.ts";

const PRODUCT_HTML = `
<!doctype html>
<html lang="ko">
  <head>
    <meta property="og:type" content="product" />
    <meta property="og:title" content="민트 티트리 쿨링 샤워젤" />
    <meta property="og:description" content="운동 후 땀과 냄새 고민을 상쾌하게 씻는 쿨링 바디워시" />
    <meta property="og:image" content="https://shop.example.com/images/mint-main.jpg" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "민트 티트리 쿨링 샤워젤",
        "brand": { "@type": "Brand", "name": "오리지널소스" },
        "image": [
          "https://shop.example.com/images/mint-main.jpg",
          "https://shop.example.com/images/mint-detail.jpg"
        ],
        "offers": {
          "@type": "Offer",
          "price": "12900",
          "availability": "https://schema.org/InStock"
        },
        "aggregateRating": { "ratingValue": "4.8", "reviewCount": "1842" }
      }
    </script>
  </head>
  <body>
    <h1>민트 티트리 쿨링 샤워젤</h1>
    <p>민트잎 7,927장 성분으로 운동 후 상쾌한 쿨링 케어</p>
    <p>첫 구매 10% 할인 쿠폰</p>
    <p>3만원 이상 무료배송</p>
    <p>여름 운동 후 샤워에 추천</p>
    <button>바로 구매하기</button>
  </body>
</html>`;

function product(overrides = {}) {
  return {
    id: "product-1",
    productName: "민트 티트리 쿨링 샤워젤",
    brandName: "오리지널소스",
    category: "바디워시",
    productUrl: "https://shop.example.com/product/mint/65",
    representativeImage: "https://shop.example.com/images/mint-main.jpg",
    additionalImages: [
      "https://shop.example.com/images/mint-detail-1.jpg",
      "https://shop.example.com/images/mint-detail-2.jpg",
    ],
    regularPrice: 18_000,
    salePrice: 12_900,
    discountRate: 28,
    benefits: ["첫 구매 10% 할인 쿠폰", "3만원 이상 무료배송"],
    coupon: "첫 구매 10% 할인 쿠폰",
    freeShipping: true,
    setComposition: undefined,
    giftBenefit: undefined,
    membershipBenefit: undefined,
    stockStatus: "in-stock",
    options: ["250ml"],
    description: "운동 후 땀과 냄새 고민을 상쾌하게 씻는 쿨링 바디워시",
    uspCandidates: ["민트잎 7,927장", "쿨링 샤워"],
    ingredients: ["민트", "티트리"],
    origin: "영국",
    certifications: ["비건 인증"],
    reviewCount: 1_842,
    rating: 4.8,
    extractedReviewPhrases: ["상쾌함이 오래가요"],
    badges: ["베스트"],
    promotionEndsAt: undefined,
    hasPurchaseButton: true,
    shippingInfo: "3만원 이상 무료배송",
    usageContexts: ["운동 후", "여름"],
    targetSignals: ["운동인", "남성"],
    discoveredFrom: ["베스트 상품"],
    analyzedAt: "2026-08-14T00:00:00.000Z",
    evidence: [
      { key: "product-name", label: "상품명", state: "present", value: "민트 티트리 쿨링 샤워젤", source: "json-ld" },
      { key: "description", label: "상품 설명", state: "present", value: "쿨링 바디워시", source: "open-graph" },
      { key: "price", label: "판매가", state: "present", value: 12_900, source: "json-ld" },
      { key: "regular-price", label: "정상가", state: "present", value: 18_000, source: "page-html" },
      { key: "reviews", label: "리뷰·평점", state: "present", value: 1_842, source: "json-ld" },
      { key: "images", label: "상품 이미지", state: "present", value: ["main", "detail"], source: "page-html" },
      { key: "purchase-button", label: "구매 버튼", state: "present", value: true, source: "page-html" },
      { key: "stock", label: "판매 상태", state: "present", value: "in-stock", source: "json-ld" },
      { key: "benefits", label: "가격·혜택", state: "present", value: ["쿠폰"], source: "page-html" },
      { key: "usp", label: "USP", state: "present", value: ["민트잎 7,927장"], source: "derived" },
      { key: "origin", label: "원산지·제조국", state: "present", value: "영국", source: "page-html" },
      { key: "certifications", label: "인증·시험 근거", state: "present", value: ["비건 인증"], source: "page-html" },
      { key: "shipping", label: "배송 안내", state: "present", value: "무료배송", source: "page-html" },
    ],
    ...overrides,
  };
}

function extractionInput(overrides = {}) {
  const summary = {
    id: "fixture-product",
    name: "민트 티트리 쿨링 샤워젤",
    url: "https://shop.example.com/product/mint/65",
    category: "바디워시",
    imageUrl: "https://shop.example.com/images/mint-main.jpg",
    originalPrice: 18_000,
    salePrice: 12_900,
    discountRate: 28,
    reviewCount: 1_842,
    rating: 4.8,
    discoveredFrom: ["JSON-LD 상품 목록"],
    ...overrides,
  };
  const detail = {
    product: summary,
    description: "운동 후 땀과 냄새 고민을 상쾌하게 씻는 쿨링 바디워시",
    uspCandidates: ["민트잎 7,927장", "쿨링 샤워"],
    specifications: { 주요성분: "민트, 티트리", 제조국: "영국" },
    imageUrls: [summary.imageUrl].filter(Boolean),
    detailImageUrls: ["https://shop.example.com/images/mint-detail.jpg"],
  };
  return { summary, detail };
}

test("홈페이지 URL 유형을 판별한다", () => {
  assert.equal(detectSitePageType("https://shop.example.com/", "<html></html>"), "homepage");
});

test("카테고리 URL 유형을 판별한다", () => {
  assert.equal(
    detectSitePageType("https://shop.example.com/category/body/24", "<html></html>"),
    "category"
  );
});

test("기획전 URL 유형을 판별한다", () => {
  assert.equal(
    detectSitePageType("https://shop.example.com/event/summer", "<html></html>"),
    "promotion"
  );
});

test("상품 URL과 JSON-LD Product를 상품 상세페이지로 판별한다", () => {
  assert.equal(
    detectSitePageType("https://shop.example.com/product/mint/65", PRODUCT_HTML),
    "product"
  );
  assert.equal(
    detectSitePageType("https://shop.example.com/custom-view", PRODUCT_HTML),
    "product"
  );
});

test("일반 콘텐츠 페이지는 unsupported로 판별한다", () => {
  assert.equal(
    detectSitePageType("https://shop.example.com/blog/story", "<html></html>"),
    "unsupported"
  );
});

test("추적 파라미터를 제거하고 동일 상품 URL을 중복 제거한다", () => {
  const items = [
    { url: "https://shop.example.com/product/mint/65?utm_source=meta" },
    { url: "https://shop.example.com/product/mint/65?fbclid=abc" },
    { url: "https://shop.example.com/product/soap/66" },
  ];
  const result = deduplicateProductUrls(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].url.includes("utm_source"), false);
  assert.equal(normalizeSitePageUrl(`${items[2].url}#reviews`).includes("#"), false);
});

test("상품 URL 후보는 최대 30개까지만 유지한다", () => {
  const result = deduplicateProductUrls(
    Array.from({ length: 45 }, (_, index) => ({
      url: `https://shop.example.com/product/item/${index + 1}`,
    }))
  );
  assert.equal(result.length, 30);
});

test("JSON-LD와 기존 추출기를 통해 상품·가격·평점·이미지를 추출한다", () => {
  const { summary, detail } = extractionInput();
  const result = extractSiteProductRecord({ html: PRODUCT_HTML, summary, detail });
  assert.equal(result.productName, "민트 티트리 쿨링 샤워젤");
  assert.equal(result.brandName, "오리지널소스");
  assert.equal(result.salePrice, 12_900);
  assert.equal(result.reviewCount, 1_842);
  assert.equal(result.rating, 4.8);
  assert.equal(result.representativeImage?.includes("mint-main.jpg"), true);
  assert.equal(result.hasPurchaseButton, true);
});

test("공통 정책의 품절 문구를 현재 상품 품절로 오인하지 않는다", () => {
  const html = PRODUCT_HTML.replace(
    "</body>",
    "<footer>품절된 상품은 구매할 수 없습니다.</footer></body>"
  );
  const { summary, detail } = extractionInput({ isSoldOut: true });
  const result = extractSiteProductRecord({ html, summary, detail });
  assert.equal(result.stockStatus, "in-stock");
});

test("공통 메뉴 혜택과 UI 아이콘을 상품 근거로 사용하지 않는다", () => {
  const html = PRODUCT_HTML.replace(
    "</body>",
    `<nav><span>현재 진행 이벤트 종료된 이벤트 카톡 채널 쿠폰 세트 혜택 회원 혜택</span></nav>
     <button>성인인증 하기</button></body>`
  );
  const { summary, detail } = extractionInput();
  detail.imageUrls.push(
    "https://img.echosting.cafe24.com/skin/base_ko_KR/product/btn_count_up.gif"
  );
  detail.uspCandidates.push("혜택 현재 진행 이벤트 종료된 이벤트 카톡 채널 쿠폰 세트 혜택 -->");
  const result = extractSiteProductRecord({ html, summary, detail });
  assert.equal(result.setComposition, undefined);
  assert.equal(result.certifications.some((value) => /성인인증/.test(value)), false);
  assert.equal(result.benefits.some((value) => /현재 진행 이벤트|세트 혜택/.test(value)), false);
  assert.equal(result.usageContexts.some((value) => /선물/.test(value)), false);
  assert.equal(
    [result.representativeImage, ...result.additionalImages].some((value) =>
      /btn_count_up\.gif/.test(value || "")
    ),
    false
  );
});

test("비활성 품절 구매 버튼은 명시적 품절로 판정한다", () => {
  const html = PRODUCT_HTML.replace(
    '<button>바로 구매하기</button>',
    '<button class="sold-out" disabled>품절</button>'
  ).replace('"availability": "https://schema.org/InStock"', '"availability": "https://schema.org/OutOfStock"');
  const { summary, detail } = extractionInput({ isSoldOut: true });
  const result = extractSiteProductRecord({ html, summary, detail });
  assert.equal(result.stockStatus, "sold-out");
});

test("JSON-LD가 없으면 Open Graph 상품명·설명·이미지를 사용한다", () => {
  const html = `
    <meta property="og:type" content="product" />
    <meta property="og:title" content="OG 전용 상품" />
    <meta property="og:description" content="OG 설명" />
    <meta property="og:image" content="https://shop.example.com/og.jpg" />
    <button>구매하기</button>`;
  const { summary, detail } = extractionInput({
    id: "og-product",
    name: "",
    url: "https://shop.example.com/product/og/91",
    imageUrl: "https://shop.example.com/og.jpg",
    reviewCount: undefined,
    rating: undefined,
  });
  detail.description = undefined;
  detail.uspCandidates = [];
  detail.detailImageUrls = [];
  const result = extractSiteProductRecord({ html, summary, detail });
  assert.equal(result.productName, "OG 전용 상품");
  assert.equal(result.description, "OG 설명");
  assert.equal(result.representativeImage, "https://shop.example.com/og.jpg");
});

test("리뷰 미확인은 리뷰 0개가 아니라 unavailable로 유지한다", () => {
  const html = `<meta property="og:type" content="product" /><meta property="og:title" content="리뷰 비공개 상품" /><meta property="og:image" content="https://shop.example.com/no-review.jpg" />`;
  const { summary, detail } = extractionInput({
    id: "no-review",
    name: "리뷰 비공개 상품",
    url: "https://shop.example.com/product/no-review/92",
    imageUrl: "https://shop.example.com/no-review.jpg",
    reviewCount: undefined,
    rating: undefined,
  });
  const result = extractSiteProductRecord({ html, summary, detail });
  const reviewEvidence = result.evidence.find((field) => field.key === "reviews");
  assert.equal(result.reviewCount, undefined);
  assert.equal(reviewEvidence?.state, "unavailable");
  assert.match(reviewEvidence?.note || "", /0개인 것이 아니라/);
});

test("광고 적합도는 여섯 항목 합계이며 0~100 범위를 지킨다", () => {
  const candidate = buildSiteAdCandidate(product(), new Date("2026-08-14T00:00:00Z"));
  assert.deepEqual(Object.keys(candidate.score.sections).sort(), [
    "creative",
    "landing",
    "messageUsp",
    "offer",
    "season",
    "trust",
  ]);
  assert.equal(
    Object.values(candidate.score.sections).reduce((sum, section) => sum + section.maxScore, 0),
    100
  );
  assert.ok(candidate.score.total >= 0 && candidate.score.total <= 100);
});

test("근거 충분도는 점수와 분리되어 공개정보 양에 따라 계산한다", () => {
  assert.equal(evidenceLevelForProduct(product()), "high");
  assert.equal(
    evidenceLevelForProduct(
      product({
        salePrice: undefined,
        benefits: [],
        reviewCount: undefined,
        rating: undefined,
        extractedReviewPhrases: [],
        additionalImages: [],
        hasPurchaseButton: false,
      })
    ),
    "low"
  );
});

test("추천 이유는 실제 상품 근거만 인용하고 판매성과를 예측하지 않는다", () => {
  const candidate = buildSiteAdCandidate(product());
  const reasons = candidate.recommendationReasons.join(" ");
  assert.match(reasons, /1,842개|민트잎 7,927장|28%/);
  assert.doesNotMatch(reasons, /ROAS|전환율이 높|판매 가능성이 높|매출 상승/);
});

test("명시적 품절 상품과 대표 이미지 없는 상품을 제외한다", () => {
  assert.match(exclusionReasons(product({ stockStatus: "sold-out" })).join(" "), /품절/);
  assert.match(exclusionReasons(product({ representativeImage: undefined })).join(" "), /대표 이미지/);
});

test("추천 후보는 최대 8개이고 유형·카테고리 다양성을 우선한다", () => {
  const types = [
    "review-trust",
    "core-usp",
    "price-benefit",
    "problem-solution",
    "situation",
    "visual-hook",
    "new-product-test",
    "seasonal-test",
    "bundle-value",
    "clear-target",
  ];
  const tiers = ["evidence-backed", "content-potential", "experiment"];
  const candidates = types.map((type, index) => ({
    ...buildSiteAdCandidate(product({ id: `p-${index}`, productUrl: `https://shop.example.com/product/p/${index}` })),
    id: `candidate-${index}`,
    primaryRecommendationType: type,
    recommendationTypes: [type],
    tier: tiers[index % tiers.length],
    score: {
      ...buildSiteAdCandidate(product()).score,
      total: 100 - index,
    },
    product: product({
      id: `p-${index}`,
      productUrl: `https://shop.example.com/product/p/${index}`,
      category: `카테고리-${index % 4}`,
    }),
  }));
  const selected = selectDiverseSiteCandidates(candidates, 8);
  assert.equal(selected.length, 8);
  assert.deepEqual(selected.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(new Set(selected.map((item) => item.primaryRecommendationType)).size >= 6);
  assert.ok(new Set(selected.map((item) => item.product.category)).size >= 3);
});

test("동일 호스트만 같은 사이트로 허용한다", () => {
  assert.equal(
    isSameStoreDomain("https://shop.example.com/product/1", "https://shop.example.com/"),
    true
  );
  assert.equal(
    isSameStoreDomain("https://cdn.example.com/product/1", "https://shop.example.com/"),
    false
  );
});

test("사설·루프백·링크 로컬·메타데이터 IP를 식별한다", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.10", "169.254.169.254", "::1"]) {
    assert.equal(isPrivateIpAddress(address), true, address);
  }
  assert.equal(isPrivateIpAddress("8.8.8.8"), false);
});

test("localhost, 사설 IP, 메타데이터 IP, 비 HTTP 프로토콜을 차단한다", async () => {
  for (const unsafeUrl of [
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://10.0.0.2/",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
  ]) {
    await assert.rejects(() => validatePublicHttpUrl(unsafeUrl), /분석할 수 없습니다|공개 URL/);
  }
});

test("공개 URL이 내부 주소로 리디렉션되면 재검증해 차단한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  try {
    await assert.rejects(() => safeFetchHtml("http://8.8.8.8/product/1"), /내부망|사설 IP/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("요청 시간이 초과되면 TIMEOUT 오류로 처리한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  try {
    await assert.rejects(
      () => safeFetchHtml("http://8.8.8.8/product/1", { timeoutMs: 5 }),
      (error) => error?.code === "TIMEOUT"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

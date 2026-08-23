import type { CremaInputProvider, CremaMarketImport, Product, ProductDailyMetric, ProductReviewMetric, ReviewInsight } from "./types.ts";

export function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const fieldAliases: Record<string, string[]> = {
  externalId: ["externalid", "external_id", "crema상품id", "크리마상품id", "상품id", "productid", "product_id", "id"],
  code: ["code", "상품코드", "productcode", "product_code", "sku"],
  name: ["name", "상품명", "productname", "product_name"],
  category: ["category", "카테고리", "categoryname", "category_name"],
  categoryId: ["categoryid", "category_id", "카테고리id"],
  url: ["url", "상품url", "producturl", "product_url"],
  imageUrl: ["image", "imageurl", "image_url", "이미지", "이미지url", "상품이미지"],
  originalPrice: ["originalprice", "original_price", "정가", "소비자가", "orgprice", "org_price"],
  finalPrice: ["finalprice", "final_price", "판매가", "할인가", "price"],
  stockCount: ["stock", "stockcount", "stock_count", "재고", "재고수"],
  cost: ["cost", "원가", "매입가", "productcost", "product_cost"],
  margin: ["margin", "마진", "이익", "contributionmargin", "contribution_margin"],
  status: ["status", "상품상태", "productstatus", "product_status"],
  display: ["display", "진열", "노출여부", "displayed"],
  createdAt: ["createdat", "created_at", "등록일", "출시일"],
  date: ["date", "일자", "날짜", "기준일"],
  impressions: ["impressions", "노출", "노출수"],
  views: ["views", "view", "조회", "조회수", "상품조회수"],
  cartAdds: ["cartadds", "cart_adds", "장바구니", "장바구니수", "장바구니담기"],
  paidOrders: ["paidorders", "paid_orders", "주문", "결제주문", "결제주문수", "orders"],
  paidQuantity: ["paidquantity", "paid_quantity", "결제수량", "판매수량", "quantity"],
  revenue: ["revenue", "매출", "결제금액", "sales"],
  refunds: ["refunds", "환불", "환불건수"],
  refundAmount: ["refundamount", "refund_amount", "환불금액"],
  uniqueVisitors: ["uniquevisitors", "unique_visitors", "순방문자", "방문자수", "uv"],
  checkoutStarts: ["checkoutstarts", "checkout_starts", "결제시작", "결제시작수"],
  cancelledOrders: ["cancelledorders", "cancelled_orders", "취소주문", "취소건수"],
  cancelledQuantity: ["cancelledquantity", "cancelled_quantity", "취소수량"],
  cancelledRevenue: ["cancelledrevenue", "cancelled_revenue", "취소금액"],
  refundedQuantity: ["refundedquantity", "refunded_quantity", "환불수량"],
  newCustomers: ["newcustomers", "new_customers", "신규고객", "신규고객수"],
  returningCustomers: ["returningcustomers", "returning_customers", "재구매고객", "기존고객수"],
  repeatOrders: ["repeatorders", "repeat_orders", "재구매", "재구매주문", "재구매주문수"],
  reviewCount: ["reviewcount", "review_count", "후기수", "리뷰수", "reviews"],
  photoReviewCount: ["photoreviewcount", "photo_review_count", "포토후기수", "포토리뷰수"],
  averageRating: ["averagerating", "average_rating", "평균평점", "평점", "rating"],
  positiveCount: ["positivecount", "positive_count", "긍정후기수"],
  negativeCount: ["negativecount", "negative_count", "부정후기수"],
  topic: ["topic", "주제", "후기주제", "키워드"],
  summary: ["summary", "요약", "후기요약"],
  polarity: ["polarity", "감성", "긍부정"],
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s.-]/g, "");
}

function pick(row: Record<string, unknown>, field: keyof typeof fieldAliases) {
  const entries = Object.entries(row);
  const aliases = new Set(fieldAliases[field].map(normalizeHeader));
  return entries.find(([key]) => aliases.has(normalizeHeader(key)))?.[1];
}

export function nullableNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(
    String(value)
      .replace(/[,₩원%]/g, "")
      .trim()
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: unknown) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function nullableBoolean(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (["true", "1", "y", "yes", "예", "진열", "노출"].includes(String(value).trim().toLowerCase())) return true;
  if (["false", "0", "n", "no", "아니오", "미진열", "비노출"].includes(String(value).trim().toLowerCase())) return false;
  return null;
}

export function normalizeDate(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + value);
    return epoch.toISOString().slice(0, 10);
  }
  const text = String(value).trim().replace(/[./]/g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function normalizeProductRows(params: { advertiserId: string; rows: Record<string, unknown>[]; provider: CremaInputProvider; now?: string }) {
  const warnings: string[] = [];
  const now = params.now || new Date().toISOString();
  const products: Product[] = [];
  params.rows.forEach((row, index) => {
    const name = nullableText(pick(row, "name"));
    const externalId = nullableText(pick(row, "externalId"));
    const code = nullableText(pick(row, "code"));
    if (!name) {
      warnings.push(`상품 시트 ${index + 2}행: 상품명이 없어 제외했습니다.`);
      return;
    }
    const id = `product-${params.advertiserId}-${stableKey(externalId || code || name)}`;
    const categoryName = nullableText(pick(row, "category"));
    const categoryId = nullableText(pick(row, "categoryId")) || (categoryName ? `category-${stableKey(categoryName)}` : null);
    const fields: Array<keyof Product> = ["externalId", "code", "name", "categoryId", "categoryName", "url", "imageUrl", "originalPrice", "finalPrice", "stockCount", "status", "display", "createdAt"];
    products.push({
      id,
      advertiserId: params.advertiserId,
      externalId,
      code,
      name,
      categoryId,
      categoryName,
      url: nullableText(pick(row, "url")),
      imageUrl: nullableText(pick(row, "imageUrl")),
      originalPrice: nullableNumber(pick(row, "originalPrice")),
      finalPrice: nullableNumber(pick(row, "finalPrice")),
      stockCount: nullableNumber(pick(row, "stockCount")),
      status: nullableText(pick(row, "status")),
      display: nullableBoolean(pick(row, "display")),
      createdAt: normalizeDate(pick(row, "createdAt")),
      firstSeenAt: normalizeDate(pick(row, "createdAt")) || now,
      updatedAt: now,
      provenance: Object.fromEntries(fields.map((field) => [field, params.provider])),
      cremaProductId: externalId,
      productCode: code,
      productName: name,
      sellingPrice: nullableNumber(pick(row, "originalPrice")),
      discountPrice: nullableNumber(pick(row, "finalPrice")),
      cost: nullableNumber(pick(row, "cost")),
      margin: nullableNumber(pick(row, "margin")),
      stockQuantity: nullableNumber(pick(row, "stockCount")),
      productUrl: nullableText(pick(row, "url")),
      representativeImageUrl: nullableText(pick(row, "imageUrl")),
      registeredAt: normalizeDate(pick(row, "createdAt")),
    });
  });
  return { products, warnings };
}

function productForRow(row: Record<string, unknown>, products: Product[]) {
  const raw = nullableText(pick(row, "externalId")) || nullableText(pick(row, "code")) || nullableText(pick(row, "name"));
  return products.find((product) => [product.externalId, product.code, product.name, product.id].filter(Boolean).some((value) => String(value).toLowerCase() === String(raw).toLowerCase()));
}

export function normalizeMetricRows(params: { advertiserId: string; rows: Record<string, unknown>[]; products: Product[]; provider: CremaInputProvider }) {
  const warnings: string[] = [];
  const metrics: ProductDailyMetric[] = [];
  params.rows.forEach((row, index) => {
    const product = productForRow(row, params.products);
    const date = normalizeDate(pick(row, "date"));
    if (!product || !date) {
      warnings.push(`지표 시트 ${index + 2}행: 상품 또는 날짜를 연결할 수 없어 제외했습니다.`);
      return;
    }
    const ratingCount = nullableNumber(pick(row, "reviewCount"));
    const averageRating = nullableNumber(pick(row, "averageRating"));
    const now = new Date().toISOString();
    const paidOrders = nullableNumber(pick(row, "paidOrders"));
    const paidQuantity = nullableNumber(pick(row, "paidQuantity"));
    const grossRevenue = nullableNumber(pick(row, "revenue"));
    const cancelledOrders = nullableNumber(pick(row, "cancelledOrders"));
    const cancelledQuantity = nullableNumber(pick(row, "cancelledQuantity"));
    const cancelledRevenue = nullableNumber(pick(row, "cancelledRevenue"));
    const refundedOrders = nullableNumber(pick(row, "refunds"));
    const refundedQuantity = nullableNumber(pick(row, "refundedQuantity"));
    const refundedRevenue = nullableNumber(pick(row, "refundAmount"));
    const net = (gross: number | null, ...deductions: Array<number | null>) => (gross === null ? null : gross - deductions.filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0));
    const fieldProvenance = Object.fromEntries(Object.keys(fieldAliases).map((field) => [field, params.provider]));
    metrics.push({
      advertiserId: params.advertiserId,
      productId: product.id,
      date,
      impressions: nullableNumber(pick(row, "impressions")),
      views: nullableNumber(pick(row, "views")),
      cartAdds: nullableNumber(pick(row, "cartAdds")),
      paidOrders,
      paidQuantity,
      revenue: grossRevenue,
      refunds: refundedOrders,
      refundAmount: refundedRevenue,
      repeatOrders: nullableNumber(pick(row, "repeatOrders")),
      stockCount: nullableNumber(pick(row, "stockCount")),
      reviewCount: ratingCount,
      photoReviewCount: nullableNumber(pick(row, "photoReviewCount")),
      ratingSum: ratingCount !== null && averageRating !== null ? ratingCount * averageRating : null,
      ratingCount,
      source: params.provider,
      id: `daily-${product.id}-${date}`,
      productImpressions: nullableNumber(pick(row, "impressions")),
      uniqueVisitors: nullableNumber(pick(row, "uniqueVisitors")),
      checkoutStarts: nullableNumber(pick(row, "checkoutStarts")),
      grossRevenue,
      cancelledOrders,
      cancelledQuantity,
      cancelledRevenue,
      refundedOrders,
      refundedRevenue,
      netOrders: net(paidOrders, cancelledOrders, refundedOrders),
      netQuantity: net(paidQuantity, cancelledQuantity, refundedQuantity),
      netRevenue: net(grossRevenue, cancelledRevenue, refundedRevenue),
      stockQuantity: nullableNumber(pick(row, "stockCount")),
      newCustomers: nullableNumber(pick(row, "newCustomers")),
      returningCustomers: nullableNumber(pick(row, "returningCustomers")),
      newReviewCount: ratingCount,
      averageRating,
      createdAt: now,
      updatedAt: now,
      fieldProvenance,
    });
  });
  return { metrics, warnings };
}

export function normalizeReviewRows(params: { advertiserId: string; rows: Record<string, unknown>[]; products: Product[]; provider: CremaInputProvider }) {
  const warnings: string[] = [];
  const reviewMetrics: ProductReviewMetric[] = [];
  const reviewInsights: ReviewInsight[] = [];
  params.rows.forEach((row, index) => {
    const product = productForRow(row, params.products);
    if (!product) {
      warnings.push(`후기 시트 ${index + 2}행: 상품을 연결할 수 없어 제외했습니다.`);
      return;
    }
    const date = normalizeDate(pick(row, "date")) || new Date().toISOString().slice(0, 10);
    const averageRating = nullableNumber(pick(row, "averageRating"));
    reviewMetrics.push({
      advertiserId: params.advertiserId,
      productId: product.id,
      date,
      reviewCount: nullableNumber(pick(row, "reviewCount")),
      photoReviewCount: nullableNumber(pick(row, "photoReviewCount")),
      averageRating,
      positiveCount: nullableNumber(pick(row, "positiveCount")),
      negativeCount: nullableNumber(pick(row, "negativeCount")),
    });
    const summary = nullableText(pick(row, "summary"));
    const topic = nullableText(pick(row, "topic"));
    if (summary || topic) {
      const rawPolarity = String(pick(row, "polarity") || "").toLowerCase();
      const polarity = /부정|negative|bad/.test(rawPolarity) || (averageRating !== null && averageRating < 3.5) ? "negative" : /혼합|mixed/.test(rawPolarity) ? "mixed" : "positive";
      reviewInsights.push({
        id: `review-insight-${product.id}-${stableKey(`${topic}-${summary}-${index}`)}`,
        advertiserId: params.advertiserId,
        productId: product.id,
        polarity,
        topic: topic || "후기 요약",
        summary: summary || topic || "",
        evidenceCount: nullableNumber(pick(row, "reviewCount")) || 1,
        averageRating,
        sourceReviewIds: [],
        createdAt: new Date().toISOString(),
      });
    }
  });
  return { reviewMetrics, reviewInsights, warnings };
}

export function normalizeWorkbookRows(params: { advertiserId: string; advertiserName: string; brandName?: string; domain?: string; productRows: Record<string, unknown>[]; metricRows: Record<string, unknown>[]; reviewRows?: Record<string, unknown>[]; provider?: CremaInputProvider; now?: string }): CremaMarketImport {
  const provider = params.provider || "file_upload";
  const normalizedProducts = normalizeProductRows({ advertiserId: params.advertiserId, rows: params.productRows, provider, now: params.now });
  const normalizedMetrics = normalizeMetricRows({ advertiserId: params.advertiserId, rows: params.metricRows, products: normalizedProducts.products, provider });
  const normalizedReviews = normalizeReviewRows({ advertiserId: params.advertiserId, rows: params.reviewRows || [], products: normalizedProducts.products, provider });
  const advertiser: CremaMarketImport["advertiser"] = {
    id: params.advertiserId,
    name: params.advertiserName,
    brandName: params.brandName || params.advertiserName,
    domain: params.domain || null,
    timezone: "Asia/Seoul",
  };
  return {
    advertiser,
    products: normalizedProducts.products,
    dailyMetrics: normalizedMetrics.metrics,
    reviewMetrics: normalizedReviews.reviewMetrics,
    reviewInsights: normalizedReviews.reviewInsights,
    warnings: [...normalizedProducts.warnings, ...normalizedMetrics.warnings, ...normalizedReviews.warnings],
  };
}

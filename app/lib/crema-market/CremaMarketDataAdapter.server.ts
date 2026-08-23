import { isoDateShift } from "./aggregation.ts";
import { normalizeWorkbookRows, stableKey } from "./normalizer.ts";
import type { CremaMarketImport } from "./types.ts";

export interface CremaMarketDataAdapter {
  readonly provider: "crema_api";
  checkConnection(): Promise<{ connected: boolean; message: string }>;
  collect(params: { advertiserId: string; advertiserName: string; brandName?: string; domain?: string; periodDays?: 1 | 7 | 14 | 28 }): Promise<CremaMarketImport>;
}

type JsonObject = Record<string, unknown>;

function requiredEnvironment(name: "CREMA_APP_ID" | "CREMA_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : "크리마 API 요청에 실패했습니다.";
  return message
    .replace(process.env.CREMA_APP_ID || "__NO_APP_ID__", "[APP_ID]")
    .replace(process.env.CREMA_SECRET || "__NO_SECRET__", "[SECRET]")
    .slice(0, 500);
}

function nextLink(headers: Headers) {
  const link = headers.get("link") || "";
  const match = link
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/i.test(part))
    ?.match(/<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1]);
  if (url.protocol !== "https:" || url.hostname !== "api.cre.ma") throw new Error("허용되지 않은 크리마 API 페이지 링크입니다.");
  return url.toString();
}

function arrayPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload as JsonObject[];
  const record = payload && typeof payload === "object" ? (payload as JsonObject) : {};
  for (const key of ["products", "orders", "reviews", "data"]) {
    if (Array.isArray(record[key])) return record[key] as JsonObject[];
  }
  return [];
}

async function safeApiFetch(url: string, init: RequestInit, timeoutMs = 15000) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.cre.ma") throw new Error("크리마 공식 API 호스트만 요청할 수 있습니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(parsed, { ...init, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class OfficialCremaApiAdapter implements CremaMarketDataAdapter {
  readonly provider = "crema_api" as const;
  private token: string | null = null;

  private async authenticate() {
    if (this.token) return this.token;
    const response = await safeApiFetch("https://api.cre.ma/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: requiredEnvironment("CREMA_APP_ID"),
        client_secret: requiredEnvironment("CREMA_SECRET"),
      }),
    });
    if (!response.ok) throw new Error(`크리마 인증 실패 (${response.status})`);
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new Error("크리마 인증 응답에 access_token이 없습니다.");
    this.token = payload.access_token;
    return payload.access_token;
  }

  private async requestAll(pathOrUrl: string, maxPages = 30) {
    const token = await this.authenticate();
    let url = pathOrUrl.startsWith("https://") ? pathOrUrl : `https://api.cre.ma${pathOrUrl}`;
    const rows: JsonObject[] = [];
    for (let page = 0; page < maxPages && url; page += 1) {
      const response = await safeApiFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`크리마 API 요청 실패 (${response.status})`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 15 * 1024 * 1024) throw new Error("크리마 API 응답 크기가 제한을 초과했습니다.");
      rows.push(...arrayPayload(await response.json()));
      url = nextLink(response.headers) || "";
    }
    return rows;
  }

  async checkConnection() {
    try {
      await this.authenticate();
      return { connected: true, message: "크리마 공식 API 인증에 성공했습니다." };
    } catch (error) {
      return { connected: false, message: redactError(error) };
    }
  }

  async collect(params: { advertiserId: string; advertiserName: string; brandName?: string; domain?: string; periodDays?: 1 | 7 | 14 | 28 }) {
    const periodDays = params.periodDays || 28;
    const seoulNow = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startsOn = isoDateShift(seoulNow, -(periodDays - 1));
    const warnings = ["FIELD_UNAVAILABLE: 크리마 공식 API에는 상품 노출·조회·장바구니·환불·마진 일별 지표가 없어 해당 값은 null입니다. 필요하면 CSV/XLSX로 보완하세요."];
    try {
      const products = await this.requestAll("/v1/products?limit=100");
      const reviews = await this.requestAll(`/v1/reviews?limit=100&start_date=${startsOn}&end_date=${seoulNow}`).catch((error) => {
        warnings.push(`API_PARTIAL: 리뷰 API를 읽지 못했습니다. ${redactError(error)}`);
        return [];
      });
      const dates = Array.from({ length: periodDays }, (_, index) => isoDateShift(startsOn, index));
      const orders: JsonObject[] = [];
      for (let offset = 0; offset < dates.length; offset += 4) {
        const batch = dates.slice(offset, offset + 4);
        const rows = await Promise.all(
          batch.map(async (paidOn) =>
            this.requestAll(`/v1/orders?limit=100&paid_on=${paidOn}`, 100)
              .then((items) => items.map((order) => ({ ...order, __paid_on: paidOn })))
              .catch((error) => {
                warnings.push(`API_PARTIAL: ${paidOn} 주문 API를 읽지 못했습니다. ${redactError(error)}`);
                return [];
              })
          )
        );
        orders.push(...rows.flat());
      }
      const productRows = products.map((product) => {
        const categories = Array.isArray(product.categories) ? (product.categories as JsonObject[]) : [];
        const image = product.image && typeof product.image === "object" ? (product.image as JsonObject) : {};
        return {
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          category_id: categories[0]?.id,
          category_name: categories[0]?.name,
          product_url: product.url,
          image_url: product.image_url || image.middle_url || image.url,
          org_price: product.org_price,
          final_price: product.final_price,
          stock_count: product.stock_count,
          product_status: product.product_status,
          display: product.display,
          created_at: product.created_at,
        };
      });
      const daily = new Map<string, Record<string, unknown>>();
      const ensure = (productId: unknown, dateValue: unknown) => {
        const date = String(dateValue || seoulNow).slice(0, 10);
        const key = `${productId}-${date}`;
        const row = daily.get(key) || { product_id: productId, date, paid_orders: 0, paid_quantity: null, revenue: 0, review_count: 0, photo_review_count: 0, rating_sum: 0, rating_count: 0 };
        daily.set(key, row);
        return row;
      };
      const userProductCounts = new Map<string, number>();
      for (const order of orders) {
        const subOrders = Array.isArray(order.sub_orders) ? (order.sub_orders as JsonObject[]) : [];
        const paidDate = String(order.__paid_on || order.paid_at || order.created_at || seoulNow).slice(0, 10);
        for (const subOrder of subOrders) {
          if (/cancel|refund|취소|환불/i.test(String(subOrder.status || ""))) continue;
          const row = ensure(subOrder.product_id || subOrder.product_code, paidDate);
          row.paid_orders = Number(row.paid_orders || 0) + 1;
          const count = typeof subOrder.product_count === "number" ? subOrder.product_count : null;
          if (count !== null) row.paid_quantity = Number(row.paid_quantity || 0) + count;
          const priceObject = subOrder.price && typeof subOrder.price === "object" ? (subOrder.price as JsonObject) : null;
          const price = typeof subOrder.price === "number" ? subOrder.price : typeof priceObject?.cents === "number" ? priceObject.cents : null;
          if (price !== null) row.revenue = Number(row.revenue || 0) + price;
          const anonymousUserKey = String(order.user_code || order.username || "").trim();
          if (anonymousUserKey) {
            const key = `${anonymousUserKey}::${subOrder.product_id || subOrder.product_code}`;
            const seen = userProductCounts.get(key) || 0;
            if (seen > 0) row.repeat_orders = Number(row.repeat_orders || 0) + 1;
            userProductCounts.set(key, seen + 1);
          }
        }
      }
      const reviewMessages: Array<{ id: string; productId: string; rating: number | null; message: string }> = [];
      for (const review of reviews) {
        const productId = review.product_id || review.product_code;
        const row = ensure(productId, review.created_at);
        row.review_count = Number(row.review_count || 0) + 1;
        row.photo_review_count = Number(row.photo_review_count || 0) + (Number(review.images_count || 0) > 0 ? 1 : 0);
        const score = typeof review.score === "number" ? review.score : null;
        if (score !== null) {
          row.rating_sum = Number(row.rating_sum || 0) + score;
          row.rating_count = Number(row.rating_count || 0) + 1;
        }
        const message = String(review.message || "")
          .replace(/[\w.+-]+@[\w.-]+/g, "[이메일]")
          .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "[연락처]")
          .slice(0, 800);
        if (message) reviewMessages.push({ id: String(review.id || stableKey(message)), productId: String(productId), rating: score, message });
      }
      const normalized = normalizeWorkbookRows({
        advertiserId: params.advertiserId,
        advertiserName: params.advertiserName,
        brandName: params.brandName,
        domain: params.domain,
        productRows,
        metricRows: Array.from(daily.values()).map((row) => {
          const ratingCount = Number(row.rating_count || 0);
          return { ...row, average_rating: ratingCount ? Number(row.rating_sum || 0) / ratingCount : null };
        }),
        provider: "crema_api",
      });
      const byExternal = new Map(
        normalized.products.flatMap((product) =>
          [
            [product.externalId, product],
            [product.code, product],
          ].filter((entry): entry is [string, typeof product] => Boolean(entry[0]))
        )
      );
      const tokenCounts = new Map<string, { productId: string; polarity: "positive" | "negative"; count: number; ratings: number[]; ids: string[] }>();
      for (const review of reviewMessages) {
        const product = byExternal.get(review.productId);
        if (!product) continue;
        const polarity = (review.rating ?? 5) < 3.5 ? "negative" : "positive";
        const tokens = Array.from(new Set(review.message.match(/[가-힣a-zA-Z]{2,12}/g) || [])).slice(0, 20);
        for (const token of tokens) {
          if (/배송|구매|상품|정말|너무|사용|좋아요|합니다|있어요/.test(token)) continue;
          const key = `${product.id}-${polarity}-${token.toLowerCase()}`;
          const current = tokenCounts.get(key) || { productId: product.id, polarity, count: 0, ratings: [], ids: [] };
          current.count += 1;
          if (review.rating !== null) current.ratings.push(review.rating);
          current.ids.push(review.id);
          tokenCounts.set(key, current);
        }
      }
      const insights = Array.from(tokenCounts.entries())
        .filter(([, value]) => value.count >= 2)
        .sort((left, right) => right[1].count - left[1].count)
        .slice(0, 60)
        .map(([key, value]) => {
          const topic = key.split("-").at(-1) || "후기";
          return {
            id: `review-insight-${stableKey(key)}`,
            advertiserId: params.advertiserId,
            productId: value.productId,
            polarity: value.polarity,
            topic,
            summary: `${topic} 관련 ${value.polarity === "positive" ? "긍정" : "부정"} 의견이 반복됩니다.`,
            evidenceCount: value.count,
            averageRating: value.ratings.length ? value.ratings.reduce((sum, rating) => sum + rating, 0) / value.ratings.length : null,
            sourceReviewIds: value.ids.slice(0, 20),
            createdAt: new Date().toISOString(),
          } as const;
        });
      return { ...normalized, reviewInsights: insights, warnings: [...warnings, ...normalized.warnings] };
    } catch (error) {
      throw new Error(redactError(error));
    }
  }
}

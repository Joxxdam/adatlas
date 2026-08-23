import "server-only";

import { runReadOnlyBigQuery } from "./client.server";
import type { BigQueryProductSignalRow } from "./scoring";
import type { BigQueryAdvertiser } from "./types";

type AdvertiserRow = {
  source: "host24" | "hostmk";
  brand_name: string;
  brand_id: string | number | null;
  category: string | null;
  store_url: string | null;
  latest_data_date: string;
  product_count: string | number;
};

type ProductSignalQueryRow = {
  product_name: string;
  product_id_hint: string | null;
  current_sales: string | number | null;
  previous_sales: string | number | null;
  current_exposures: string | number | null;
  previous_exposures: string | number | null;
  current_purchases: string | number | null;
  previous_purchases: string | number | null;
  current_carts: string | number | null;
  conversion_rate: string | number | null;
  sales_change_rate: string | number | null;
  average_exposures: string | number | null;
  brand_conversion_rate: string | number | null;
  brand_total_sales: string | number | null;
  brand_total_purchases: string | number | null;
  product_sales_share: string | number | null;
  product_purchase_share: string | number | null;
  sales_rank: string | number;
  purchase_rank: string | number;
  product_count: string | number;
  recent_1_week_sales: string | number | null;
  recent_1_week_purchases: string | number | null;
  recent_4_week_sales: string | number | null;
  previous_4_week_sales: string | number | null;
  recent_8_week_sales: string | number | null;
  recent_12_week_sales: string | number | null;
  recent_4_week_purchases: string | number | null;
  previous_4_week_purchases: string | number | null;
  periods_available: string | number;
  latest_date: string;
};

const ADVERTISER_SQL = `
WITH source_catalog AS (
  SELECT
    'host24' AS source,
    NORMALIZE(TRIM(BRAND_NAME), NFKC) AS brand_name,
    MAX(DATE(\`DATE\`)) AS latest_data_date,
    COUNT(DISTINCT REGEXP_REPLACE(NORMALIZE(TRIM(PRODUCT_NAME), NFKC), r'[\\p{Cf}]', '')) AS product_count
  FROM \`first-project-394906.FACT_HOST24.PRODUCT\`
  WHERE DATE(\`DATE\`) >= DATE_SUB(CURRENT_DATE(), INTERVAL @freshnessDays DAY)
    AND BRAND_NAME IS NOT NULL
    AND PRODUCT_NAME IS NOT NULL
  GROUP BY brand_name

  UNION ALL

  SELECT
    'hostmk' AS source,
    NORMALIZE(TRIM(BRAND_NAME), NFKC) AS brand_name,
    MAX(DATE(\`DATE\`)) AS latest_data_date,
    COUNT(DISTINCT REGEXP_REPLACE(NORMALIZE(TRIM(PRODUCT_NAME), NFKC), r'[\\p{Cf}]', '')) AS product_count
  FROM \`first-project-394906.FACT_HOSTMK.PRODUCT\`
  WHERE DATE(\`DATE\`) >= DATE_SUB(CURRENT_DATE(), INTERVAL @freshnessDays DAY)
    AND BRAND_NAME IS NOT NULL
    AND PRODUCT_NAME IS NOT NULL
  GROUP BY brand_name
),
brand_matches AS (
  SELECT
    CAST(BRAND_ID AS STRING) AS brand_id,
    NORMALIZE(TRIM(BRAND_NAME), NFKC) AS normalized_brand_name,
    URL AS store_url,
    COALESCE(NULLIF(TRIM(CREMA_DEPTH1), ''), NULLIF(TRIM(CREMA_DEPTH2), '')) AS category,
    ROW_NUMBER() OVER (
      PARTITION BY NORMALIZE(TRIM(BRAND_NAME), NFKC)
      ORDER BY UPDATED_AT DESC, BRAND_ID
    ) AS match_rank
  FROM \`first-project-394906.DIM_MALL.CAT_BRANDS\`
  WHERE BRAND_NAME IS NOT NULL
)
SELECT
  catalog.source,
  catalog.brand_name,
  matched.brand_id,
  matched.category,
  matched.store_url,
  CAST(catalog.latest_data_date AS STRING) AS latest_data_date,
  catalog.product_count
FROM source_catalog AS catalog
LEFT JOIN brand_matches AS matched
  ON matched.normalized_brand_name = catalog.brand_name
 AND matched.match_rank = 1
WHERE catalog.product_count > 0
ORDER BY catalog.latest_data_date DESC, catalog.brand_name
LIMIT @rowLimit
`;

const productTables = {
  host24: "first-project-394906.FACT_HOST24.PRODUCT",
  hostmk: "first-project-394906.FACT_HOSTMK.PRODUCT",
} as const;

function productSignalSql(source: keyof typeof productTables) {
  const table = productTables[source];
  return `
WITH source_rows AS (
  SELECT
    DATE(\`DATE\`) AS event_date,
    REGEXP_REPLACE(NORMALIZE(TRIM(PRODUCT_NAME), NFKC), r'[\\p{Cf}]', '') AS product_name,
    COALESCE(SAFE_CAST(EXPOSURE_NUM AS FLOAT64), 0) AS exposures,
    COALESCE(SAFE_CAST(CART_NUM AS FLOAT64), 0) AS carts,
    COALESCE(SAFE_CAST(PURCHASE_NUM AS FLOAT64), 0) AS purchases,
    COALESCE(SAFE_CAST(PURCHASE_AMOUNT AS FLOAT64), 0) AS sales
  FROM \`${table}\`
  WHERE NORMALIZE(TRIM(BRAND_NAME), NFKC) = NORMALIZE(TRIM(@brandName), NFKC)
    AND PRODUCT_NAME IS NOT NULL
    AND DATE(\`DATE\`) BETWEEN DATE(@historyStart) AND DATE(@currentEnd)
),
aggregated AS (
  SELECT
    product_name,
    REGEXP_EXTRACT(product_name, r'\\(([0-9]+)\\)\\s*$') AS product_id_hint,
    SUM(IF(event_date BETWEEN DATE(@currentStart) AND DATE(@currentEnd), sales, 0)) AS current_sales,
    SUM(IF(event_date BETWEEN DATE(@previousStart) AND DATE(@previousEnd), sales, 0)) AS previous_sales,
    SUM(IF(event_date BETWEEN DATE(@currentStart) AND DATE(@currentEnd), exposures, 0)) AS current_exposures,
    SUM(IF(event_date BETWEEN DATE(@previousStart) AND DATE(@previousEnd), exposures, 0)) AS previous_exposures,
    SUM(IF(event_date BETWEEN DATE(@currentStart) AND DATE(@currentEnd), purchases, 0)) AS current_purchases,
    SUM(IF(event_date BETWEEN DATE(@previousStart) AND DATE(@previousEnd), purchases, 0)) AS previous_purchases,
    SUM(IF(event_date BETWEEN DATE(@currentStart) AND DATE(@currentEnd), carts, 0)) AS current_carts,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), sales, 0)) AS recent_1_week_sales,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), purchases, 0)) AS recent_1_week_purchases,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 27 DAY) AND DATE(@currentEnd), sales, 0)) AS recent_4_week_sales,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 55 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 28 DAY), sales, 0)) AS previous_4_week_sales,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 55 DAY) AND DATE(@currentEnd), sales, 0)) AS recent_8_week_sales,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 83 DAY) AND DATE(@currentEnd), sales, 0)) AS recent_12_week_sales,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 27 DAY) AND DATE(@currentEnd), purchases, 0)) AS recent_4_week_purchases,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 55 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 28 DAY), purchases, 0)) AS previous_4_week_purchases,
    SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 83 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 56 DAY), sales, 0)) AS older_4_week_sales
  FROM source_rows
  GROUP BY product_name, product_id_hint
),
active_products AS (
  SELECT
    product_name,
    product_id_hint,
    current_sales,
    previous_sales,
    current_exposures,
    previous_exposures,
    current_purchases,
    previous_purchases,
    current_carts,
    recent_1_week_sales,
    recent_1_week_purchases,
    recent_4_week_sales,
    previous_4_week_sales,
    recent_8_week_sales,
    recent_12_week_sales,
    recent_4_week_purchases,
    previous_4_week_purchases,
    CAST(recent_4_week_sales > 0 AS INT64)
      + CAST(previous_4_week_sales > 0 AS INT64)
      + CAST(older_4_week_sales > 0 AS INT64) AS periods_available,
    SAFE_DIVIDE(current_purchases, NULLIF(current_exposures, 0)) AS conversion_rate,
    SAFE_DIVIDE(current_sales - previous_sales, NULLIF(previous_sales, 0)) AS sales_change_rate
  FROM aggregated
  WHERE current_sales > 0 OR current_exposures > 0 OR current_purchases > 0
),
brand_stats AS (
  SELECT
    AVG(current_exposures) AS average_exposures,
    SAFE_DIVIDE(SUM(current_purchases), NULLIF(SUM(current_exposures), 0)) AS brand_conversion_rate,
    SUM(current_sales) AS brand_total_sales,
    SUM(current_purchases) AS brand_total_purchases,
    COUNT(1) AS product_count
  FROM active_products
),
ranked AS (
  SELECT
    product_name,
    product_id_hint,
    current_sales,
    previous_sales,
    current_exposures,
    previous_exposures,
    current_purchases,
    previous_purchases,
    current_carts,
    recent_1_week_sales,
    recent_1_week_purchases,
    recent_4_week_sales,
    previous_4_week_sales,
    recent_8_week_sales,
    recent_12_week_sales,
    recent_4_week_purchases,
    previous_4_week_purchases,
    periods_available,
    conversion_rate,
    sales_change_rate,
    RANK() OVER (ORDER BY current_sales DESC, current_purchases DESC, product_name) AS sales_rank,
    RANK() OVER (ORDER BY current_purchases DESC, current_sales DESC, product_name) AS purchase_rank
  FROM active_products
)
SELECT
  ranked.product_name,
  ranked.product_id_hint,
  ranked.current_sales,
  ranked.previous_sales,
  ranked.current_exposures,
  ranked.previous_exposures,
  ranked.current_purchases,
  ranked.previous_purchases,
  ranked.current_carts,
  ranked.recent_1_week_sales,
  ranked.recent_1_week_purchases,
  ranked.recent_4_week_sales,
  ranked.previous_4_week_sales,
  ranked.recent_8_week_sales,
  ranked.recent_12_week_sales,
  ranked.recent_4_week_purchases,
  ranked.previous_4_week_purchases,
  ranked.periods_available,
  ranked.conversion_rate,
  ranked.sales_change_rate,
  brand_stats.average_exposures,
  brand_stats.brand_conversion_rate,
  brand_stats.brand_total_sales,
  brand_stats.brand_total_purchases,
  SAFE_DIVIDE(ranked.current_sales, NULLIF(brand_stats.brand_total_sales, 0)) AS product_sales_share,
  SAFE_DIVIDE(ranked.current_purchases, NULLIF(brand_stats.brand_total_purchases, 0)) AS product_purchase_share,
  ranked.sales_rank,
  ranked.purchase_rank,
  brand_stats.product_count,
  @currentEnd AS latest_date
FROM ranked
CROSS JOIN brand_stats
ORDER BY ranked.current_sales DESC, ranked.current_purchases DESC, ranked.product_name
LIMIT @rowLimit
`;
}

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function encodeBigQueryAdvertiserId(source: "host24" | "hostmk", brandName: string) {
  return `bqa.${source}.${Buffer.from(brandName, "utf8").toString("base64url")}`;
}

export function decodeBigQueryAdvertiserId(value: string) {
  const [prefix, source, encodedBrand, extra] = value.split(".");
  if (prefix !== "bqa" || extra || (source !== "host24" && source !== "hostmk") || !encodedBrand) {
    return null;
  }
  try {
    const brandName = Buffer.from(encodedBrand, "base64url").toString("utf8").trim();
    if (!brandName || brandName.length > 160) return null;
    return { source, brandName } as const;
  } catch {
    return null;
  }
}

export async function queryBigQueryAdvertisers() {
  const result = await runReadOnlyBigQuery<AdvertiserRow>({
    queryName: "ad-candidates-brands",
    sql: ADVERTISER_SQL,
    params: { freshnessDays: 180, rowLimit: 500 },
    maxResults: 500,
  });
  const advertisers: BigQueryAdvertiser[] = result.rows.map((row) => ({
    id: encodeBigQueryAdvertiserId(row.source, row.brand_name),
    source: row.source,
    name: row.brand_name,
    brandId: row.brand_id === null ? null : String(row.brand_id),
    category: row.category || null,
    storeUrl: row.store_url || null,
    latestDataDate: row.latest_data_date,
    productCount: numberValue(row.product_count),
    brandMatchConfidence: row.brand_id === null ? "unmatched" : "exact",
  }));
  return { ...result, rows: advertisers };
}

export async function queryBigQueryProductSignals(input: { source: "host24" | "hostmk"; brandName: string; currentStart: string; currentEnd: string; previousStart: string; previousEnd: string; historyStart: string }) {
  const result = await runReadOnlyBigQuery<ProductSignalQueryRow>({
    queryName: `ad-candidates-${input.source}`,
    sql: productSignalSql(input.source),
    params: {
      brandName: input.brandName,
      currentStart: input.currentStart,
      currentEnd: input.currentEnd,
      previousStart: input.previousStart,
      previousEnd: input.previousEnd,
      historyStart: input.historyStart,
      rowLimit: 200,
    },
    maxResults: 200,
  });
  const rows: BigQueryProductSignalRow[] = result.rows.map((row) => ({
    productName: row.product_name,
    productIdHint: row.product_id_hint || null,
    currentSales: numberValue(row.current_sales),
    previousSales: numberValue(row.previous_sales),
    currentExposures: numberValue(row.current_exposures),
    previousExposures: numberValue(row.previous_exposures),
    currentPurchases: numberValue(row.current_purchases),
    previousPurchases: numberValue(row.previous_purchases),
    currentCarts: numberValue(row.current_carts),
    conversionRate: nullableNumber(row.conversion_rate),
    salesChangeRate: nullableNumber(row.sales_change_rate),
    averageExposures: numberValue(row.average_exposures),
    brandConversionRate: nullableNumber(row.brand_conversion_rate),
    brandTotalSales: numberValue(row.brand_total_sales),
    brandTotalPurchases: numberValue(row.brand_total_purchases),
    productSalesShare: nullableNumber(row.product_sales_share) ?? 0,
    productPurchaseShare: nullableNumber(row.product_purchase_share) ?? 0,
    salesRank: numberValue(row.sales_rank),
    purchaseRank: numberValue(row.purchase_rank),
    productCount: numberValue(row.product_count),
    recent1WeekSales: numberValue(row.recent_1_week_sales),
    recent1WeekPurchases: numberValue(row.recent_1_week_purchases),
    recent4WeekSales: numberValue(row.recent_4_week_sales),
    previous4WeekSales: numberValue(row.previous_4_week_sales),
    recent8WeekSales: numberValue(row.recent_8_week_sales),
    recent12WeekSales: numberValue(row.recent_12_week_sales),
    recent4WeekPurchases: numberValue(row.recent_4_week_purchases),
    previous4WeekPurchases: numberValue(row.previous_4_week_purchases),
    periodsAvailable: numberValue(row.periods_available),
    latestDate: row.latest_date,
  }));
  return { ...result, rows };
}

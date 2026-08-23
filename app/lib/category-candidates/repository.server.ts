import "server-only";

import { runReadOnlyBigQuery } from "../bigquery/client.server";

const tables = {
  host24: "first-project-394906.FACT_HOST24.PRODUCT",
  hostmk: "first-project-394906.FACT_HOSTMK.PRODUCT",
} as const;

type Row = {
  product_name: string;
  current_7_sales: string | number | null;
  previous_7_sales: string | number | null;
  current_7_orders: string | number | null;
  previous_7_orders: string | number | null;
  week_0_sales: string | number | null;
  week_1_sales: string | number | null;
  week_2_sales: string | number | null;
  week_3_sales: string | number | null;
  week_0_orders: string | number | null;
  week_1_orders: string | number | null;
  week_2_orders: string | number | null;
  week_3_orders: string | number | null;
  latest_date: string;
};

function numberValue(value: string | number | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sql(source: keyof typeof tables) {
  return `
WITH source_rows AS (
  SELECT
    DATE(\`DATE\`) AS event_date,
    REGEXP_REPLACE(NORMALIZE(TRIM(PRODUCT_NAME), NFKC), r'[\\p{Cf}]', '') AS product_name,
    COALESCE(SAFE_CAST(PURCHASE_AMOUNT AS FLOAT64), 0) AS sales,
    COALESCE(SAFE_CAST(PURCHASE_NUM AS FLOAT64), 0) AS orders
  FROM \`${tables[source]}\`
  WHERE NORMALIZE(TRIM(BRAND_NAME), NFKC) = NORMALIZE(TRIM(@brandName), NFKC)
    AND PRODUCT_NAME IS NOT NULL
    AND DATE(\`DATE\`) BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 27 DAY) AND DATE(@currentEnd)
)
SELECT
  product_name,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), sales, 0)) AS current_7_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 13 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 7 DAY), sales, 0)) AS previous_7_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), orders, 0)) AS current_7_orders,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 13 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 7 DAY), orders, 0)) AS previous_7_orders,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), sales, 0)) AS week_0_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 13 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 7 DAY), sales, 0)) AS week_1_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 20 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 14 DAY), sales, 0)) AS week_2_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 27 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 21 DAY), sales, 0)) AS week_3_sales,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 6 DAY) AND DATE(@currentEnd), orders, 0)) AS week_0_orders,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 13 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 7 DAY), orders, 0)) AS week_1_orders,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 20 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 14 DAY), orders, 0)) AS week_2_orders,
  SUM(IF(event_date BETWEEN DATE_SUB(DATE(@currentEnd), INTERVAL 27 DAY) AND DATE_SUB(DATE(@currentEnd), INTERVAL 21 DAY), orders, 0)) AS week_3_orders,
  CAST(MAX(event_date) AS STRING) AS latest_date
FROM source_rows
GROUP BY product_name
HAVING SUM(sales) > 0 OR SUM(orders) > 0
ORDER BY current_7_sales DESC, current_7_orders DESC
LIMIT @rowLimit
`;
}

export async function queryCategoryProductSignals(input: { source: "host24" | "hostmk"; brandName: string; currentEnd: string }) {
  const result = await runReadOnlyBigQuery<Row>({
    queryName: `category-candidates-${input.source}`,
    sql: sql(input.source),
    params: { brandName: input.brandName, currentEnd: input.currentEnd, rowLimit: 500 },
    maxResults: 500,
  });
  return {
    ...result,
    rows: result.rows.map((row) => ({
      productName: row.product_name,
      current7Sales: numberValue(row.current_7_sales),
      previous7Sales: numberValue(row.previous_7_sales),
      current7Orders: numberValue(row.current_7_orders),
      previous7Orders: numberValue(row.previous_7_orders),
      weeklySales: [numberValue(row.week_0_sales), numberValue(row.week_1_sales), numberValue(row.week_2_sales), numberValue(row.week_3_sales)] as [number, number, number, number],
      weeklyOrders: [numberValue(row.week_0_orders), numberValue(row.week_1_orders), numberValue(row.week_2_orders), numberValue(row.week_3_orders)] as [number, number, number, number],
      latestDate: row.latest_date,
    })),
  };
}

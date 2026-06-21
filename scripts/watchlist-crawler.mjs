const baseUrl = process.env.ADATLAS_BASE_URL ?? "http://127.0.0.1:3000";
const limit = Number(process.env.WATCHLIST_CRAWL_LIMIT ?? 100);
const priority = process.env.WATCHLIST_PRIORITY;

const response = await fetch(`${baseUrl}/api/watchlist/crawl`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ limit, priority }),
});
const result = await response.json();

if (!response.ok) {
  throw new Error(result.error ?? `HTTP ${response.status}`);
}

console.log(
  `watchlist brands=${result.brands} analyses=${result.analyses} added=${result.added} total=${result.total}`,
);

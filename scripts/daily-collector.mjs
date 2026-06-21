const baseUrl = process.env.ADATLAS_BASE_URL ?? "http://127.0.0.1:3000";
const sources = ["meta", "tiktok", "pinterest"];

function dateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const payloadBase = {
  query: process.env.COLLECT_QUERY ?? "beauty fashion food",
  country: process.env.COLLECT_COUNTRY ?? "KR",
  fromDate: process.env.COLLECT_FROM_DATE ?? dateString(1),
  toDate: process.env.COLLECT_TO_DATE ?? dateString(0),
  limit: Number(process.env.COLLECT_LIMIT ?? 25),
};

for (const source of sources) {
  try {
    const response = await fetch(`${baseUrl}/api/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payloadBase, source }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? `HTTP ${response.status}`);
    }

    console.log(`[${source}] fetched=${result.fetched} added=${result.added} total=${result.total}`);
  } catch (error) {
    console.error(`[${source}] ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

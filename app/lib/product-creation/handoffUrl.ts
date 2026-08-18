export function normalizeProductCreationUrl(value?: string | null) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildProductCreationHref(
  handoff: Record<string, string | null | undefined>,
  productUrl?: string | null
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(handoff)) {
    const normalized = String(value || "").trim();
    if (normalized) params.set(key, normalized);
  }
  const normalizedProductUrl = normalizeProductCreationUrl(productUrl);
  if (normalizedProductUrl) params.set("productUrl", normalizedProductUrl);
  const query = params.toString();
  return query ? `/create-product?${query}` : "/create-product";
}

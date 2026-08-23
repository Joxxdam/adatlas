export const META_FORBIDDEN_CREATIVE_FIELDS = ["asset_feed_spec", "catalog_id", "product_set_id", "degrees_of_freedom_spec", "advantage_plus_creative", "standard_enhancements", "sitelink_spec", "shop_destination", "website_highlights"] as const;

export const META_AUTOMATION_OFF_POLICY = {
  label: "ALL_AUTOMATIONS_OFF" as const,
  fixedCta: "SHOP_NOW" as const,
  singleMediaOnly: true,
  flexibleCreative: false,
  dynamicCreative: false,
  assetFeed: false,
  catalog: false,
  shop: false,
  siteLinks: false,
  websiteHighlights: false,
  generativeAi: false,
};

export function assertNoMetaAutomationOptIn(payload: unknown) {
  const serialized = JSON.stringify(payload);
  const found = META_FORBIDDEN_CREATIVE_FIELDS.filter((field) => serialized.includes(`"${field}"`));
  if (found.length) throw new Error(`자동 크리에이티브 필드가 포함되었습니다: ${found.join(", ")}`);
  if (/\bACTIVE\b/.test(serialized)) throw new Error("ACTIVE 상태는 허용되지 않습니다.");
}

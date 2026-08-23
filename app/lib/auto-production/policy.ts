import type { AutoProductionAdvertiserConfig } from "./types";

export const AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME = "07:00";
export const AUTO_PRODUCTION_PRODUCTS_PER_MALL = 4;
export const AUTO_PRODUCTION_CREATIVES_PER_PRODUCT = 6;
export const AUTO_PRODUCTION_IMAGES_PER_MALL =
  AUTO_PRODUCTION_PRODUCTS_PER_MALL * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT;

export function automaticImageCountForConfig(
  config: Pick<
    AutoProductionAdvertiserConfig,
    "enabled" | "productsPerRun" | "maxImagesPerRun"
  >
) {
  if (!config.enabled) return 0;
  return Math.min(
    config.productsPerRun * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
    config.maxImagesPerRun
  );
}

export function minimumDailyImageCapacity(
  configs: Array<
    Pick<
      AutoProductionAdvertiserConfig,
      "enabled" | "productsPerRun" | "maxImagesPerRun"
    >
  >
) {
  return configs.reduce(
    (sum, config) => sum + automaticImageCountForConfig(config),
    0
  );
}

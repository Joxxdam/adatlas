import type { StoreExtractor, StorePlatform } from "./types";
import { cafe24Extractor } from "./extractors/cafe24Extractor";
import { genericStoreExtractor } from "./extractors/genericStoreExtractor";

export function detectStorePlatform(url: string, html = ""): StorePlatform {
  const hostname = new URL(url).hostname.toLowerCase();
  if (cafe24Extractor.canHandle(url, html)) return "cafe24";
  if (/makeshop|shopdetail\.html|branduid|mk_mall|ezadmin/i.test(`${hostname} ${html}`)) {
    return "makeshop";
  }
  if (
    /cdn\.shopify\.com|shopify-section|shopify-payment|Shopify\.theme|\.myshopify\.com/i.test(html)
  ) {
    return "shopify";
  }
  if (
    /smartstore\.naver\.com|shopping\.naver\.com|__PRELOADED_STATE__/i.test(`${hostname} ${html}`)
  ) {
    return "smartstore";
  }
  if (/<html|<!doctype\s+html/i.test(html)) return "generic";
  return "unknown";
}

export function extractorForPlatform(platform: StorePlatform): StoreExtractor {
  return platform === "cafe24" ? cafe24Extractor : genericStoreExtractor;
}

import { NextResponse } from "next/server";
import { POST as extractProduct } from "../../extract/product/route";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { autoProductionAdvertiserRepository, normalizeAdvertiserConfig } from "../../../lib/auto-production/advertiserConfig.server";
import { directProductCandidate, directProductInfo } from "../../../lib/auto-production/directProduct.server";
import { publicAutoProductionError, toPublicAutoProductionRun } from "../../../lib/auto-production/publicAutoProduction.server";
import { runAutoProductionForProduct } from "../../../lib/auto-production/productionRunner.server";
import { runAutoProductionNow } from "../../../lib/auto-production/scheduler.server";
import type { ExtractedProductInfo } from "../../../lib/mvp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

async function directAdvertiser(advertiserId: string | undefined, productUrl: string, extracted: ExtractedProductInfo) {
  const configs = await autoProductionAdvertiserRepository.list();
  if (advertiserId) {
    const selected = configs.find((config) => config.advertiserId === advertiserId);
    if (!selected) throw new Error("선택한 광고주 설정을 찾지 못했습니다.");
    return selected;
  }
  const productHost = hostname(productUrl);
  const matched = configs.find((config) => [config.siteUrl, ...config.adminProductUrls].some((value) => hostname(value) === productHost));
  if (matched) return matched;
  const brandName = String(extracted.brandName || "").trim();
  const brandMatched = brandName
    ? configs.find((config) => [config.advertiserName, config.bigQueryBrandMatch, ...config.aliases].some((value) => value.replace(/\s+/g, "").toLowerCase() === brandName.replace(/\s+/g, "").toLowerCase()))
    : undefined;
  if (brandMatched) return brandMatched;
  const advertiserName = brandName || productHost.split(".")[0] || "직접 입력 상품";
  return normalizeAdvertiserConfig({
    advertiserId: `direct-${productHost || "product"}`,
    advertiserName,
    bigQueryBrandMatch: advertiserName,
    siteUrl: productUrl,
    enabled: true,
    adObjective: "purchase",
  });
}

export async function POST(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const body = (await request.json().catch(() => ({}))) as { advertiserId?: string; productUrl?: string; trigger?: "manual" | "cli"; force?: boolean };
    const productUrl = String(body.productUrl || "").trim();
    if (productUrl) {
      const extractionResponse = await extractProduct(
        new Request(request.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productUrl }),
        })
      );
      const extraction = (await extractionResponse.json()) as { productInfo?: ExtractedProductInfo; error?: string };
      if (!extractionResponse.ok || !extraction.productInfo) {
        return NextResponse.json({ ok: false, error: extraction.error || "상품 상세정보를 불러오지 못했습니다." }, { status: extractionResponse.status || 400 });
      }
      const config = await directAdvertiser(body.advertiserId, productUrl, extraction.productInfo);
      const product = directProductInfo(extraction.productInfo, productUrl, config);
      const result = await runAutoProductionForProduct(config, directProductCandidate(config, product, productUrl));
      return NextResponse.json({ ok: true, mode: "direct-product", results: result.run ? [{ created: result.created, run: toPublicAutoProductionRun(result.run) }] : [] }, { status: 202 });
    }
    const trigger = body.trigger || "manual";
    const results = await runAutoProductionNow({ advertiserId: body.advertiserId, trigger, force: trigger === "manual" ? true : Boolean(body.force) });
    return NextResponse.json({ ok: true, results: results.map((item) => ({ created: item.created, run: item.run ? toPublicAutoProductionRun(item.run) : null })) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 실행에 실패했습니다.") }, { status: 400 });
  }
}

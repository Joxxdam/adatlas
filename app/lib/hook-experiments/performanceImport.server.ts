import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { extractCreativeAssetCode } from "../creative-assets/code.ts";
import { creativeAssetRepository } from "../creative-assets/repository.server.ts";
import type {
  CreativeExperiment,
  ExperimentAsset,
  ExperimentObjective,
  PerformanceRecord,
} from "./types.ts";

type ParsedReportRow = Omit<
  PerformanceRecord,
  | "id"
  | "experimentId"
  | "assetId"
  | "assetCode"
  | "hookGroupId"
  | "matchStatus"
  | "matchMessage"
  | "importedAt"
>;

const aliases: Record<keyof ParsedReportRow, string[]> = {
  platform: ["플랫폼", "platform", "publisher platform"],
  objective: ["캠페인 목표", "objective", "campaign objective", "목표"],
  campaignId: ["캠페인 id", "campaign id", "campaign_id"],
  campaignName: ["캠페인 이름", "campaign name", "campaign_name"],
  adsetId: ["광고세트 id", "ad set id", "adset id", "adset_id"],
  adsetName: ["광고세트 이름", "ad set name", "adset name", "adset_name"],
  adId: ["광고 id", "ad id", "ad_id"],
  adName: ["광고 이름", "ad name", "ad_name"],
  dateStart: ["보고 시작일", "시작일", "reporting starts", "date start", "date_start"],
  dateEnd: ["보고 종료일", "종료일", "reporting ends", "date end", "date_end"],
  spend: ["지출", "지출 금액", "amount spent", "spend", "cost"],
  impressions: ["노출", "노출수", "impressions"],
  reach: ["도달", "도달수", "reach"],
  frequency: ["빈도", "frequency"],
  clicks: ["전체 클릭", "클릭", "clicks (all)", "clicks"],
  linkClicks: ["링크 클릭", "link clicks", "link_clicks"],
  outboundClicks: ["아웃바운드 클릭", "outbound clicks", "outbound_clicks"],
  landingPageViews: [
    "랜딩페이지 조회",
    "랜딩 페이지 조회",
    "landing page views",
    "landing_page_views",
  ],
  engagements: ["참여", "게시물 참여", "engagements", "post engagements"],
  purchases: ["구매", "purchases", "website purchases"],
  purchaseValue: [
    "구매전환값",
    "구매 전환값",
    "purchase conversion value",
    "purchase value",
    "conversion value",
  ],
  source: ["source", "출처"],
};

function normalizeHeader(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function value(row: Record<string, unknown>, key: keyof ParsedReportRow) {
  const entries = Object.entries(row);
  const wanted = new Set(aliases[key].map(normalizeHeader));
  return entries.find(([header]) => wanted.has(normalizeHeader(header)))?.[1];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/[,₩$원\s]/g, "")
    .trim();
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateText(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed)
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return text(value).slice(0, 10);
}

function objective(value: unknown, fallback: ExperimentObjective): ExperimentObjective {
  const normalized = text(value).toUpperCase();
  if (/AWR|인지|AWARE/.test(normalized)) return "AWR";
  if (/TRF|트래픽|유입|TRAFFIC/.test(normalized)) return "TRF";
  if (/SLS|판매|전환|SALES|CONVERSION/.test(normalized)) return "SLS";
  if (/ENG|참여|ENGAGEMENT/.test(normalized)) return "ENG";
  return fallback;
}

function platform(value: unknown): "META" | "GOOGLE" | "OTHER" {
  const normalized = text(value).toLowerCase();
  if (/google|구글/.test(normalized)) return "GOOGLE";
  if (/meta|facebook|instagram|메타|페이스북|인스타/.test(normalized)) return "META";
  return "META";
}

export const PerformanceImportService = {
  parse(
    buffer: Buffer,
    fileName: string,
    fallbackObjective: ExperimentObjective
  ): ParsedReportRow[] {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const rows = workbook.SheetNames.flatMap((sheetName) =>
      XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
        defval: null,
        raw: true,
      })
    );
    return rows.map((row, index) => ({
      platform: platform(value(row, "platform")),
      objective: objective(value(row, "objective"), fallbackObjective),
      campaignId: text(value(row, "campaignId")) || undefined,
      campaignName: text(value(row, "campaignName")),
      adsetId: text(value(row, "adsetId")) || undefined,
      adsetName: text(value(row, "adsetName")),
      adId: text(value(row, "adId")) || `row-${index + 1}`,
      adName: text(value(row, "adName")),
      dateStart: dateText(value(row, "dateStart")),
      dateEnd: dateText(value(row, "dateEnd")),
      spend: numberOrNull(value(row, "spend")),
      impressions: numberOrNull(value(row, "impressions")),
      reach: numberOrNull(value(row, "reach")),
      frequency: numberOrNull(value(row, "frequency")),
      clicks: numberOrNull(value(row, "clicks")),
      linkClicks: numberOrNull(value(row, "linkClicks")),
      outboundClicks: numberOrNull(value(row, "outboundClicks")),
      landingPageViews: numberOrNull(value(row, "landingPageViews")),
      engagements: numberOrNull(value(row, "engagements")),
      purchases: numberOrNull(value(row, "purchases")),
      purchaseValue: numberOrNull(value(row, "purchaseValue")),
      source: text(value(row, "source")) || fileName,
    }));
  },
};

export function createCreativePerformanceMatchingService(
  assetRepository: Pick<typeof creativeAssetRepository, "getByCode">
) {
  return {
    async match(input: {
      experiment: CreativeExperiment;
      experimentAssets: ExperimentAsset[];
      rows: ParsedReportRow[];
    }) {
      const importedAt = new Date().toISOString();
      const records: PerformanceRecord[] = [];
      for (const row of input.rows) {
        const code = extractCreativeAssetCode(row.adName);
        const relationship = code
          ? input.experimentAssets.find((item) => item.assetCode === code)
          : undefined;
        const asset = code ? await assetRepository.getByCode(code) : null;
        let matchStatus: PerformanceRecord["matchStatus"] = "matched";
        let matchMessage = "소재코드 자동 연결";
        if (!code) {
          matchStatus = "code_missing";
          matchMessage = "광고 이름에 소재코드가 없습니다.";
        } else if (!asset) {
          matchStatus = "asset_not_found";
          matchMessage = "소재코드에 해당하는 소재가 없습니다.";
        } else if (!relationship) {
          matchStatus = "needs_review";
          matchMessage = "소재는 존재하지만 이 실험에 연결되지 않았습니다.";
        }
        records.push({
          id: crypto.randomUUID(),
          experimentId: input.experiment.id,
          assetId: relationship?.assetId,
          assetCode: relationship?.assetCode || code || undefined,
          hookGroupId: relationship?.hookGroupId,
          ...row,
          matchStatus,
          matchMessage,
          importedAt,
        });
      }
      return records;
    },
  };
}

export const CreativePerformanceMatchingService =
  createCreativePerformanceMatchingService(creativeAssetRepository);

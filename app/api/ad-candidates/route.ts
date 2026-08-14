import { NextResponse } from "next/server";
import { BigQueryPublicError } from "../../lib/bigquery/client.server";
import { getBigQueryCandidates } from "../../lib/bigquery/candidateService.server";
import {
  bigQueryCandidatePeriods,
  bigQueryCandidateTypes,
  type BigQueryCandidatePeriod,
  type BigQueryCandidateType,
} from "../../lib/bigquery/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const advertiserId = search.get("brandId")?.trim() || "";
  const requestedPeriod = search.get("period")?.trim() || "4w";
  const requestedType = search.get("type")?.trim() || "all";
  if (!advertiserId) {
    return NextResponse.json({ ok: false, error: "brandId가 필요합니다." }, { status: 400 });
  }
  if (!bigQueryCandidatePeriods.includes(requestedPeriod as BigQueryCandidatePeriod)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 조회 기간입니다." }, { status: 400 });
  }
  if (
    requestedType !== "all" &&
    !bigQueryCandidateTypes.includes(requestedType as BigQueryCandidateType)
  ) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 후보 유형입니다." }, { status: 400 });
  }
  try {
    const result = await getBigQueryCandidates({
      advertiserId,
      period: requestedPeriod as BigQueryCandidatePeriod,
      type: requestedType as BigQueryCandidateType | "all",
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const known = error instanceof BigQueryPublicError ? error : null;
    const invalid = error instanceof Error && !known ? error.message : null;
    return NextResponse.json(
      {
        ok: false,
        errorCode: known?.code || "invalid-request",
        error: known?.message || invalid || "광고 후보를 불러오지 못했습니다.",
      },
      { status: known?.status || (invalid ? 400 : 500) }
    );
  }
}

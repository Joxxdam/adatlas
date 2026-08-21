import { NextRequest, NextResponse } from "next/server";
import { readMetaServerConfig } from "../../../lib/meta/config.server";
import { createMetaReadService } from "../../../lib/meta/readService.server";
import { metaRepository } from "../../../lib/meta/repository.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    const service = createMetaReadService();
    if (action === "connection")
      return NextResponse.json({ ok: true, result: await service.verifyConnection() });
    if (action === "accounts") {
      const config = readMetaServerConfig();
      const store = await metaRepository.read();
      const advertiserId = String(body.advertiserId || "");
      const mapping =
        store.advertiserMappings.find((item) => item.advertiserId === advertiserId) ||
        config.advertiserMap.find((item) => item.advertiserId === advertiserId);
      if (!mapping) throw new Error("광고주 Meta 자산 매핑을 먼저 저장해 주세요.");
      return NextResponse.json({ ok: true, result: await service.accounts(mapping) });
    }
    if (action === "campaigns")
      return NextResponse.json({
        ok: true,
        result: await service.campaigns(String(body.accountId || "")),
      });
    if (action === "adsets")
      return NextResponse.json({
        ok: true,
        result: await service.adSets(String(body.accountId || ""), String(body.campaignId || "")),
      });
    if (action === "ads")
      return NextResponse.json({
        ok: true,
        result: await service.ads(String(body.adSetId || "")),
      });
    return NextResponse.json(
      { ok: false, error: "지원하지 않는 Meta 읽기 작업입니다." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Meta 읽기 실패" },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { metaRepository } from "../../../lib/meta/repository.server";
import type { MetaAdvertiserAssetMap } from "../../../lib/meta/types";

export async function GET() {
  const store = await metaRepository.read();
  return NextResponse.json({ ok: true, mappings: store.advertiserMappings });
}

export async function POST(request: NextRequest) {
  try {
    const mapping = (await request.json()) as MetaAdvertiserAssetMap;
    if (!mapping.advertiserId?.trim() || !mapping.advertiserName?.trim())
      throw new Error("광고주 ID와 이름이 필요합니다.");
    if (!Array.isArray(mapping.adAccountIds)) throw new Error("광고 계정 매핑이 필요합니다.");
    return NextResponse.json({
      ok: true,
      mapping: await metaRepository.saveAdvertiserMapping(mapping),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고주 설정 저장 실패" },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { readBrands, saveBrands, upsertBrand } from "../../../lib/mvp/store";
import { MvpBrand } from "../../../lib/mvp/types";

export const runtime = "nodejs";

export async function GET() {
  const brands = await readBrands();
  return NextResponse.json({ brands });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body.brands)) {
    const now = new Date().toISOString();
    const brands = body.brands.map((item: Partial<MvpBrand> & { brandName: string }) => ({
      id: item.id || item.brandName.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-"),
      brandName: item.brandName,
      category: item.category ?? "",
      metaLibraryUrl: item.metaLibraryUrl ?? "",
      tiktokUrl: item.tiktokUrl ?? "",
      enabled: item.enabled ?? true,
      createdAt: item.createdAt ?? now,
      updatedAt: now,
    }));
    await saveBrands(brands);
    return NextResponse.json({ ok: true, brands });
  }

  if (!body.brandName) {
    return NextResponse.json({ ok: false, error: "brandName이 필요합니다." }, { status: 400 });
  }

  const brand = await upsertBrand(body);
  return NextResponse.json({ ok: true, brand });
}

import { NextResponse } from "next/server";

import { findBackgroundCatalogItem } from "../../../../lib/background-library/catalogStore.server";
import { backgroundStorage } from "../../../../lib/background-library/storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^bg-[a-z0-9-]+$/.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const item = await findBackgroundCatalogItem(id);
  if (!item || item.status === "rejected") return NextResponse.json({ ok: false }, { status: 404 });
  const size = new URL(request.url).searchParams.get("size") === "thumbnail" ? "thumbnail" : "processed";
  const key = size === "thumbnail" ? item.thumbnailPath : item.filePath;
  if (!key || !(await backgroundStorage.exists(key))) return NextResponse.json({ ok: false }, { status: 404 });
  const buffer = await backgroundStorage.read(key);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "image/webp",
      "content-length": String(buffer.length),
      "cache-control": "private, max-age=3600, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

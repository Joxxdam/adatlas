import { NextResponse } from "next/server";
import { publicMetaCapability } from "../../../lib/meta/config.server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, capability: publicMetaCapability() });
}

import { NextResponse } from "next/server";
import { readCollectedReferences } from "../../lib/collectors/store";

export const runtime = "nodejs";

export async function GET() {
  const items = await readCollectedReferences();
  return NextResponse.json({ items });
}

import { NextResponse } from "next/server";
import { createCreativeGenerationProvider } from "../../../lib/creative-generation/providers/providerFactory.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const engine = new URL(request.url).searchParams.get("engine") === "openai_api" ? "openai_api" : "codex_local";
  const status = await createCreativeGenerationProvider(engine).status();
  return NextResponse.json({
    ok: status.available,
    status: {
      ...status,
      paidApiFallback: false,
      imageGenerationAvailable: engine === "codex_local" ? status.available : status.available,
    },
  }, { status: status.available ? 200 : 503 });
}

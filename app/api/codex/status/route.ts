import { NextResponse } from "next/server";
import { createCreativeGenerationProvider } from "../../../lib/creative-generation/providers/providerFactory.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // 기본 제작 화면은 항상 ChatGPT 로그인 기반 Codex 상태만 조회한다.
  // 유료 API 준비 상태는 향후 별도 동의 화면/서버 경로에서만 다룬다.
  const engine = "codex_local" as const;
  const status = await createCreativeGenerationProvider(engine).status();
  return NextResponse.json(
    {
      ok: status.available,
      status: {
        ...status,
        paidApiFallback: false,
        imageGenerationAvailable: engine === "codex_local" ? status.available : status.available,
      },
    },
    { status: status.available ? 200 : 503 }
  );
}

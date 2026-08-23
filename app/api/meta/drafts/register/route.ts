import { NextRequest, NextResponse } from "next/server";
import { createMetaDraftRegistrationService } from "../../../../lib/meta/registration.server";
import type { MetaDraftRegistrationInput } from "../../../../lib/meta/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      input: MetaDraftRegistrationInput;
      confirmationToken: string;
    };
    return NextResponse.json({
      ok: true,
      job: await createMetaDraftRegistrationService().register(body.input, String(body.confirmationToken || "")),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PAUSED 초안 등록 실패" }, { status: 400 });
  }
}

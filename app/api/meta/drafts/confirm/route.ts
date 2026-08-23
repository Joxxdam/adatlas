import { NextRequest, NextResponse } from "next/server";
import { createMetaDraftRegistrationService } from "../../../../lib/meta/registration.server";
import type { MetaDraftRegistrationInput } from "../../../../lib/meta/types";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as MetaDraftRegistrationInput;
    return NextResponse.json({
      ok: true,
      confirmation: createMetaDraftRegistrationService().issueConfirmation(input),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "최종 확인 실패" }, { status: 400 });
  }
}

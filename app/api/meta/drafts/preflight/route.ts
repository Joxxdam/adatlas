import { NextRequest, NextResponse } from "next/server";
import { createMetaDraftRegistrationService } from "../../../../lib/meta/registration.server";
import type { MetaDraftRegistrationInput } from "../../../../lib/meta/types";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as MetaDraftRegistrationInput;
    return NextResponse.json({
      ok: true,
      preflight: createMetaDraftRegistrationService().preflight(input),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "사전 검토 실패" },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { cremaMarketRepository } from "../../../../lib/crema-market/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await context.params;
  const found = await cremaMarketRepository.findOpportunity(opportunityId);
  if (!found) return NextResponse.json({ ok: false, error: "광고 기회를 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, opportunity: found.opportunity, product: found.dataset.products.find((item) => item.id === found.opportunity.productId), insights: found.dataset.reviewInsights.filter((item) => item.productId === found.opportunity.productId) });
}

export async function PATCH(request: Request, context: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await context.params;
  const body = await request.json().catch(() => ({})) as { status?: "recommended" | "later" | "excluded" };
  if (!body.status || !["recommended", "later", "excluded"].includes(body.status)) return NextResponse.json({ ok: false, error: "지원하지 않는 상태입니다." }, { status: 400 });
  const opportunity = await cremaMarketRepository.updateOpportunity(opportunityId, { status: body.status });
  if (!opportunity) return NextResponse.json({ ok: false, error: "광고 기회를 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, opportunity });
}

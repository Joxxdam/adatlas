import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../lib/video-collaboration/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summaries = await videoProjectRepository.list();
    const projects = (
      await Promise.all(summaries.map((summary) => videoProjectRepository.get(summary.id)))
    ).filter((project) => Boolean(project));
    const people = new Map<string, { name: string; role: "designer" | "marketer" }>();
    const products = new Map<string, {
      id: string;
      advertiserName: string;
      productUrl: string;
      productName: string;
      analysis: NonNullable<(typeof projects)[number]>["productAnalysis"];
    }>();

    for (const project of projects) {
      if (!project) continue;
      if (project.marketerName && project.marketerName !== "마케터") {
        people.set(`marketer:${project.marketerName}`, {
          name: project.marketerName,
          role: "marketer",
        });
      }
      if (project.designerName && project.designerName !== "디자이너 미지정") {
        people.set(`designer:${project.designerName}`, {
          name: project.designerName,
          role: "designer",
        });
      }
      const productKey = project.productUrl || project.productAnalysis.productName;
      if (productKey && !products.has(productKey)) {
        products.set(productKey, {
          id: project.id,
          advertiserName: project.advertiserName,
          productUrl: project.productUrl,
          productName: project.productAnalysis.productName,
          analysis: project.productAnalysis,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      people: [...people.values()].sort((left, right) => {
        if (left.role !== right.role) return left.role === "designer" ? -1 : 1;
        return left.name.localeCompare(right.name, "ko");
      }),
      products: [...products.values()],
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "기획 선택지 조회 실패" },
      { status: 500 }
    );
  }
}

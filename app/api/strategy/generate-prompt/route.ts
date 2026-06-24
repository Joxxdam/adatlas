import { NextResponse } from "next/server";
import { AdImageLabel, GeneratedAdStrategyPrompt, ProductInfoForPrompt } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const requiredImagePromptTerms = [
  "square 1:1 performance marketing ecommerce ad visual",
  "no readable text",
  "no letters",
  "no numbers",
  "no logo",
  "leave empty space for Korean headline",
  "product-focused composition",
  "high contrast",
  "promotional badge shapes without text",
];

function fallbackProduct(productInfo: Partial<ProductInfoForPrompt>): ProductInfoForPrompt {
  return {
    productName: productInfo.productName ?? "",
    category: productInfo.category ?? "",
    price: productInfo.price ?? "",
    discountInfo: productInfo.discountInfo ?? "",
    mainBenefit: productInfo.mainBenefit ?? "",
    targetCustomer: productInfo.targetCustomer ?? "",
    landingUrl: productInfo.landingUrl ?? "",
  };
}

function firstUseful(labels: AdImageLabel[], key: keyof AdImageLabel["finalLabel"], fallback: string) {
  return labels.map((label) => label.finalLabel[key]).find((value) => value?.trim()) ?? fallback;
}

function mockStrategy(productInfo: ProductInfoForPrompt, labels: AdImageLabel[]): GeneratedAdStrategyPrompt {
  const hookType = firstUseful(labels, "hookType", "혜택/문제 해결 후킹");
  const appealPoint = firstUseful(labels, "appealPoint", productInfo.mainBenefit || "구매 명분을 명확하게 제시");
  const copyNuance = firstUseful(labels, "copyNuance", "직관적이고 전환 중심적인 톤");
  const visualTone = firstUseful(labels, "visualTone", "밝고 선명한 커머스형 톤");
  const layoutPattern = firstUseful(labels, "layoutPattern", "상단 훅, 중앙 상품, 하단 CTA 구조");
  const whyItWorks = firstUseful(labels, "whyItWorks", "소비자의 망설임을 줄이고 즉시 행동할 이유를 만듭니다.");
  const benefit = productInfo.mainBenefit || appealPoint;
  const discount = productInfo.discountInfo || productInfo.price;

  return {
    hookType,
    appealPoint: `${appealPoint} 구조를 ${productInfo.productName || "새 상품"}의 핵심 혜택에 맞게 변형합니다.`,
    headline: benefit ? `${benefit}, 지금 확인하세요` : `${productInfo.productName || "이 상품"}, 지금 확인하세요`,
    subCopy: `${productInfo.targetCustomer || "고객"}이 바로 이해할 수 있게 ${whyItWorks}`,
    cta: discount ? `${discount} 혜택 보기` : "자세히 보기",
    imageGenerationPrompt: [
      ...requiredImagePromptTerms,
      `${productInfo.category || "consumer product"} advertising visual`,
      `${productInfo.productName || "new product"} as hero product`,
      `${visualTone}`,
      `${layoutPattern}`,
      `${copyNuance}`,
      "adapt only the persuasion structure and layout principles from references, do not copy any existing ad",
    ].join(", "),
    textOverlayPlan: {
      canvasSize: "1200x1200",
      headlineArea: "top",
      productArea: "center",
      priceBadgeArea: "bottom-right",
      ctaArea: "bottom",
      style: `${visualTone} / ${layoutPattern}`,
    },
  };
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(source) as GeneratedAdStrategyPrompt;
}

function normalizeStrategy(value: Partial<GeneratedAdStrategyPrompt>): GeneratedAdStrategyPrompt {
  const prompt = [
    value.imageGenerationPrompt ?? "",
    ...requiredImagePromptTerms.filter((term) => !(value.imageGenerationPrompt ?? "").includes(term)),
  ].filter(Boolean).join(", ");

  return {
    hookType: String(value.hookType ?? ""),
    appealPoint: String(value.appealPoint ?? ""),
    headline: String(value.headline ?? ""),
    subCopy: String(value.subCopy ?? ""),
    cta: String(value.cta ?? ""),
    imageGenerationPrompt: prompt,
    textOverlayPlan: {
      canvasSize: "1200x1200",
      headlineArea: String(value.textOverlayPlan?.headlineArea ?? "top"),
      productArea: String(value.textOverlayPlan?.productArea ?? "center"),
      priceBadgeArea: String(value.textOverlayPlan?.priceBadgeArea ?? "bottom-right"),
      ctaArea: String(value.textOverlayPlan?.ctaArea ?? "bottom"),
      style: String(value.textOverlayPlan?.style ?? ""),
    },
  };
}

async function generateWithOpenAI(productInfo: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL ?? "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "선택된 광고 레퍼런스의 소구 구조와 레이아웃 원리만 참고해 새 상품용 광고 전략, 한국어 카피, 영어 이미지 생성 프롬프트를 만드세요. " +
                "기존 레퍼런스를 그대로 베끼지 말고 새 상품에 맞게 변형하세요. headline, subCopy, cta는 한국어. imageGenerationPrompt는 영어. " +
                `imageGenerationPrompt에는 반드시 다음 조건을 모두 포함하세요: ${requiredImagePromptTerms.join(", ")}. ` +
                "반드시 JSON만 반환하세요. 키는 hookType, appealPoint, headline, subCopy, cta, imageGenerationPrompt, textOverlayPlan 입니다.\n\n" +
                `productInfo:\n${JSON.stringify(productInfo, null, 2)}\n\nselectedReferenceLabels:\n${JSON.stringify(labels, null, 2)}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 전략 생성 실패: HTTP ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  const text =
    result.output_text ??
    result.output?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("\n") ??
    "";

  return normalizeStrategy(extractJson(text));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const productInfo = fallbackProduct(body.productInfo ?? {});
    const selectedReferenceLabels = Array.isArray(body.selectedReferenceLabels) ? (body.selectedReferenceLabels as AdImageLabel[]).slice(0, 3) : [];

    if (!productInfo.productName.trim()) {
      return NextResponse.json({ ok: false, error: "productName이 필요합니다." }, { status: 400 });
    }
    if (selectedReferenceLabels.length === 0) {
      return NextResponse.json({ ok: false, error: "라벨 완료된 레퍼런스를 1개 이상 선택하세요." }, { status: 400 });
    }

    const strategy = process.env.OPENAI_API_KEY
      ? await generateWithOpenAI(productInfo, selectedReferenceLabels)
      : mockStrategy(productInfo, selectedReferenceLabels);

    return NextResponse.json({ ok: true, strategy, isMock: !process.env.OPENAI_API_KEY });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 전략 프롬프트 생성 실패" },
      { status: 500 },
    );
  }
}

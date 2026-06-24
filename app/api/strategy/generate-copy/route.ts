import { NextResponse } from "next/server";
import { readAdImageLabels } from "../../../lib/mvp/labelStore";
import { AdImageLabel, GeneratedAdCopy, ProductInfoForPrompt } from "../../../lib/mvp/types";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  referenceLabels?: AdImageLabel[];
};

function normalizeProduct(productInfo: Partial<ProductInfoForPrompt> = {}): ProductInfoForPrompt {
  return {
    productName: productInfo.productName || "새 상품",
    category: productInfo.category || "",
    price: productInfo.price || "",
    discountInfo: productInfo.discountInfo || "",
    mainBenefit: productInfo.mainBenefit || "",
    targetCustomer: productInfo.targetCustomer || "",
    landingUrl: productInfo.landingUrl || "",
    productImagePath: productInfo.productImagePath || "",
  };
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function scoreLabel(product: ProductInfoForPrompt, label: AdImageLabel) {
  const productText = [
    product.productName,
    product.category,
    product.mainBenefit,
    product.targetCustomer,
    product.discountInfo,
  ].join(" ");
  const labelText = [
    label.category,
    label.finalLabel.category,
    label.finalLabel.hookType,
    label.finalLabel.appealPoint,
    label.finalLabel.copyNuance,
    label.finalLabel.visualTone,
    label.finalLabel.layoutPattern,
    label.finalLabel.whyItWorks,
    label.finalLabel.recommendedUse,
  ].join(" ");
  const productTokens = tokenize(productText);
  const labelTokens = tokenize(labelText);
  let score = 0;

  productTokens.forEach((token) => {
    if (labelTokens.has(token)) score += 3;
  });
  if (product.category && labelText.includes(product.category)) score += 10;
  if (label.finalLabel.appealPoint) score += 2;
  if (label.finalLabel.copyNuance) score += 2;
  if (label.finalLabel.whyItWorks) score += 2;

  return score;
}

function selectReferenceLabels(product: ProductInfoForPrompt, allLabels: AdImageLabel[], requestedLabels: AdImageLabel[] = []) {
  const source = requestedLabels.length ? requestedLabels : allLabels;
  return [...source]
    .filter((label) => label.finalLabel && Object.values(label.finalLabel).some(Boolean))
    .sort((a, b) => scoreLabel(product, b) - scoreLabel(product, a))
    .slice(0, requestedLabels.length ? 3 : 5);
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned) as Partial<GeneratedAdCopy>;
}

function normalizeCopy(value: Partial<GeneratedAdCopy>): GeneratedAdCopy {
  return {
    headline: String(value.headline ?? ""),
    bodyCopy: String(value.bodyCopy ?? ""),
    highlightCopy: String(value.highlightCopy ?? ""),
    bottomBarCopy: String(value.bottomBarCopy ?? ""),
    cta: String(value.cta ?? ""),
    hookType: String(value.hookType ?? ""),
    appealPoint: String(value.appealPoint ?? ""),
    whyThisWorks: String(value.whyThisWorks ?? ""),
  };
}

function mockCopy(product: ProductInfoForPrompt, labels: AdImageLabel[]): GeneratedAdCopy {
  const first = labels[0]?.finalLabel;
  const name = product.productName || "이 상품";
  const pricePhrase = product.price ? `${product.price}대로` : "이 조건으로";
  const benefit = product.mainBenefit || product.discountInfo || first?.appealPoint || "사야 할 이유가 분명한 혜택";

  return {
    headline: `${pricePhrase} ${name}, 그냥 지나치기 어렵습니다`,
    bodyCopy: `${product.targetCustomer || "지금 고민 중인 사람"}에게 ${benefit}을 바로 보여주는 구성입니다.`,
    highlightCopy: product.discountInfo || `${first?.appealPoint || "즉시혜택"} 제대로 챙기는 선택`,
    bottomBarCopy: `${first?.copyNuance || "강한 공감형 톤"}으로 구매 명분을 먼저 만듭니다`,
    cta: "지금 혜택 확인하기",
    hookType: first?.hookType || "상황제안형",
    appealPoint: first?.appealPoint || "즉시혜택",
    whyThisWorks: first?.whyItWorks || "상품 설명보다 구매 명분을 먼저 제시해 클릭 판단 시간을 줄입니다.",
  };
}

async function generateWithOpenAI(product: ProductInfoForPrompt, labels: AdImageLabel[]) {
  const prompt = `
너는 한국 이커머스 퍼포먼스 광고 카피라이터다.
상품 정보와 라벨링 완료된 광고 레퍼런스 finalLabel을 참고해서 1200x1200 광고 배너에 들어갈 문구를 만든다.

규칙:
- 한국어로 작성한다.
- 기존 광고 문구를 그대로 복사하지 않는다.
- category, hookType, appealPoint, copyNuance, visualTone, layoutPattern, whyItWorks, recommendedUse의 소구 구조만 참고한다.
- 단순한 "할인 중입니다"가 아니라 후킹이 강한 문구를 만든다.
- 예시 톤은 참고만 한다: "4만원대로 생색 제대로 내는 선물 찾았습니다", "와 진심 미쳤다", "아직도 이거 없이 버텼다고?"
- JSON만 반환한다.

상품 정보:
${JSON.stringify(product, null, 2)}

참고 라벨:
${JSON.stringify(labels.map((label) => ({
  imageId: label.imageId,
  category: label.category,
  finalLabel: label.finalLabel,
})), null, 2)}

반환 JSON:
{
  "headline": "",
  "bodyCopy": "",
  "highlightCopy": "",
  "bottomBarCopy": "",
  "cta": "",
  "hookType": "",
  "appealPoint": "",
  "whyThisWorks": ""
}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 광고문구 생성 실패: HTTP ${response.status}`);
  }

  const data = await response.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? []).map((item: { text?: string }) => item.text).join("") ||
    "";

  return normalizeCopy(parseJsonObject(text));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const product = normalizeProduct(body.productInfo);
    const allLabels = await readAdImageLabels();
    const selectedLabels = selectReferenceLabels(product, allLabels, body.referenceLabels ?? []);

    if (!selectedLabels.length) {
      return NextResponse.json(
        { ok: false, error: "참고할 라벨 데이터가 없습니다. 먼저 이미지 라벨을 저장해주세요." },
        { status: 400 },
      );
    }

    const copy = process.env.OPENAI_API_KEY ? await generateWithOpenAI(product, selectedLabels) : mockCopy(product, selectedLabels);

    return NextResponse.json({
      ok: true,
      copy,
      referenceLabels: selectedLabels,
      isMock: !process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고문구 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

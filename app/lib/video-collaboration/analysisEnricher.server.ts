import type { ProductAnalysisSnapshot } from "./types.ts";

function clean(value: unknown, max = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compact(value: unknown, limit = 5) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => clean(item)).filter(Boolean))).slice(0, limit);
}

function responseText(payload: unknown) {
  const value = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (value.output_text) return value.output_text;
  return (value.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("\n");
}

function normalizedNumbers(value: string) {
  return (value.match(/\d[\d,.]*/g) || []).map((item) => item.replace(/[,.]/g, ""));
}

export async function enrichVideoProductAnalysis(
  snapshot: ProductAnalysisSnapshot
): Promise<ProductAnalysisSnapshot> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      ...snapshot,
      analysisNotes: [
        "상품 사실은 기존 추출 결과입니다. 타깃과 고객 문제는 확인되지 않아 직접 입력이 필요합니다.",
      ],
    };
  }
  try {
    const facts = {
      productName: snapshot.productName,
      brandName: snapshot.brandName,
      category: snapshot.category,
      price: snapshot.price,
      discountInfo: snapshot.discountInfo,
      coreUsps: snapshot.coreUsps,
      keyFeatures: snapshot.keyFeatures,
      trustSignals: snapshot.trustSignals,
      description: snapshot.rawDescription,
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
        input: `아래 상품 공개정보만 근거로 광고 영상 기획에 사용할 타깃 고객과 해결할 고객 문제를 각각 최대 3개로 요약하세요. 입력에 없는 효능, 수치, 인증, 판매성과는 만들지 마세요. 이 두 항목은 사실 인용이 아니라 시스템의 추천 해석임을 전제로 구체적이고 짧게 작성하세요. JSON만 반환하세요.\n${JSON.stringify(facts)}\n출력: {"targetCustomers":[""],"customerProblems":[""],"cautionPhrases":[""]}`,
        text: { format: { type: "json_object" } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("analysis enrichment failed");
    const raw = responseText(await response.json())
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const targetCustomers = compact(parsed.targetCustomers, 3);
    const customerProblems = compact(parsed.customerProblems, 3);
    const cautionPhrases = compact(parsed.cautionPhrases, 5);
    const sourceNumbers = new Set(normalizedNumbers(JSON.stringify(facts)));
    const generatedNumbers = normalizedNumbers(
      [...targetCustomers, ...customerProblems, ...cautionPhrases].join(" ")
    );
    if (generatedNumbers.some((number) => !sourceNumbers.has(number)))
      throw new Error("unsupported number");
    return {
      ...snapshot,
      targetCustomers,
      customerProblems,
      cautionPhrases: Array.from(new Set([...snapshot.cautionPhrases, ...cautionPhrases])).slice(
        0,
        8
      ),
      inferredFields: ["targetCustomers", "customerProblems"],
      inferredAngles: [
        ...targetCustomers.map((value, index) => ({
          id: `inferred-target-${index + 1}`,
          label: "추천 타깃",
          value,
          source: "공개 상품정보 기반 시스템 해석",
          bucket: "inferred" as const,
        })),
        ...customerProblems.map((value, index) => ({
          id: `inferred-problem-${index + 1}`,
          label: "추천 고객 문제",
          value,
          source: "공개 상품정보 기반 시스템 해석",
          bucket: "inferred" as const,
        })),
      ],
      unsupportedClaims: cautionPhrases.map((value, index) => ({
        id: `unsupported-${index + 1}`,
        label: "사용 금지·확인 필요",
        value,
        source: "검증 규칙",
        bucket: "unsupported" as const,
      })),
      analysisNotes: [
        "상품명·가격·USP·후기 근거는 공개정보이며, 타깃과 고객 문제는 공개정보를 바탕으로 한 시스템 추천 해석입니다.",
      ],
    };
  } catch {
    return {
      ...snapshot,
      analysisNotes: [
        "상품 사실은 기존 추출 결과입니다. 타깃과 고객 문제의 자동 해석에 실패해 직접 입력이 필요합니다.",
      ],
    };
  }
}

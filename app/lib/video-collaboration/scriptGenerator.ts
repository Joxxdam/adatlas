import crypto from "node:crypto";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader.ts";
import type {
  BrandGuideline,
  ProductAnalysisSnapshot,
  VideoConcept,
  VideoCut,
  VideoDuration,
  VideoHookType,
  VideoObjective,
} from "./types.ts";
import { preserveSceneReferences } from "./script.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";

function clean(value: unknown, max = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compact(values: unknown[], limit = 10) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = clean(value, 240);
    const key = text.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function hookPriority(
  analysis: ProductAnalysisSnapshot,
  objective: VideoObjective
): VideoHookType[] {
  const scores: Array<[VideoHookType, number]> = [
    [
      "problem-solution",
      analysis.customerProblems.length ? 92 : objective === "interest" ? 62 : 30,
    ],
    [
      "price-benefit",
      analysis.price || analysis.discountInfo ? (objective === "benefit" ? 110 : 90) : 5,
    ],
    ["feature-usp", analysis.coreUsps.length || analysis.keyFeatures.length ? 100 : 35],
    [
      "sensory-scene",
      /향|맛|촉감|상쾌|시원|부드|바삭|쫀득|산뜻|색감|질감/i.test(
        [...analysis.coreUsps, ...analysis.keyFeatures].join(" ")
      )
        ? 88
        : 42,
    ],
    ["curiosity", objective === "interest" || objective === "new-product" ? 96 : 72],
    ["review-trust", analysis.trustSignals.length ? 94 : 0],
    ["brand-message", analysis.brandName ? (objective === "new-product" ? 92 : 58) : 15],
  ];
  const selected: VideoHookType[] = [];
  for (const [type] of scores.sort((left, right) => right[1] - left[1])) {
    if (!selected.includes(type)) selected.push(type);
    if (selected.length === 3) break;
  }
  return selected;
}

function evidenceFor(type: VideoHookType, analysis: ProductAnalysisSnapshot) {
  const product = analysis.productName || "이 상품";
  if (type === "problem-solution")
    return analysis.customerProblems[0] || `${product}이 필요한 상황`;
  if (type === "price-benefit") return analysis.discountInfo || analysis.price || product;
  if (type === "review-trust") return analysis.trustSignals[0] || product;
  if (type === "brand-message") return analysis.brandName || product;
  return analysis.coreUsps[0] || analysis.keyFeatures[0] || product;
}

function hookMessage(type: VideoHookType, analysis: ProductAnalysisSnapshot) {
  const product = analysis.productName || "상품";
  const evidence = evidenceFor(type, analysis);
  const usp = analysis.coreUsps[0] || analysis.keyFeatures[0] || product;
  const problem = analysis.customerProblems[0] || `${product} 선택이 어려웠다면`;
  const messages: Record<
    VideoHookType,
    { title: string; opening: string; bridge: string; firstScene: string }
  > = {
    "problem-solution": {
      title: `${problem}에서 시작하는 문제 해결 기획`,
      opening: `${problem}, 무엇부터 확인해야 할까요?`,
      bridge: `${product}에서 확인된 ${usp}를 해결 기준으로 제시합니다.`,
      firstScene: "고객이 겪는 문제 상황을 한 장면으로 구체적으로 보여준다.",
    },
    "price-benefit": {
      title: "확인된 혜택을 구매 명분으로 만드는 기획",
      opening: `${evidence}, 선택 전에 이 조건부터 보세요.`,
      bridge: `${product}의 상세페이지에서 확인된 가격·혜택만 정확하게 보여줍니다.`,
      firstScene: "확인된 가격 또는 혜택을 제품과 함께 크게 제시한다.",
    },
    "feature-usp": {
      title: "핵심 차이 한 가지를 기억시키는 USP 기획",
      opening: `${usp}, ${product}에서 먼저 볼 포인트입니다.`,
      bridge: `상세페이지에서 확인된 ${usp}를 사용 맥락과 함께 설명합니다.`,
      firstScene: "핵심 USP가 보이는 제품 디테일을 클로즈업한다.",
    },
    "sensory-scene": {
      title: "사용 순간을 장면으로 먼저 느끼게 하는 기획",
      opening: `${evidence}, 사용하는 순간은 어떻게 다를까요?`,
      bridge: `${product}의 확인된 특징을 질감·움직임·사용 장면으로 시각화합니다.`,
      firstScene: "제품의 질감이나 사용 동작을 소리와 가까운 화면으로 보여준다.",
    },
    curiosity: {
      title: "답을 다음 컷에서 공개하는 호기심 기획",
      opening: `${product}, 먼저 확인해야 할 한 가지는?`,
      bridge: `답은 ${evidence}. 다음 컷에서 확인된 근거를 공개합니다.`,
      firstScene: "제품 일부와 질문만 보여주고 핵심 답은 다음 컷까지 남겨둔다.",
    },
    "review-trust": {
      title: "확인된 후기 포인트를 제품 근거와 연결하는 기획",
      opening: `상세페이지에서 확인된 반응, “${evidence}”`,
      bridge: `${product}의 후기 문장과 확인된 제품 특징을 함께 보여줍니다.`,
      firstScene: "확인된 후기 문장을 원문 의미를 바꾸지 않고 먼저 보여준다.",
    },
    "brand-message": {
      title: "브랜드가 말하는 제품 선택 기준 기획",
      opening: `${evidence}가 ${product}에서 중요하게 본 한 가지`,
      bridge: `브랜드 톤으로 ${usp}와 제품 선택 이유를 차분하게 연결합니다.`,
      firstScene: "브랜드와 제품의 디테일을 한 프레임에서 차분하게 연결한다.",
    },
  };
  return messages[type];
}

function timeWindows(duration: VideoDuration) {
  if (duration === 15)
    return [
      [0, 3],
      [3, 7],
      [7, 11],
      [11, 15],
    ] as const;
  if (duration === 30)
    return [
      [0, 3],
      [3, 10],
      [10, 21],
      [21, 30],
    ] as const;
  return [
    [0, 3],
    [3, 18],
    [18, 43],
    [43, 60],
  ] as const;
}

function objectiveCta(objective: VideoObjective) {
  if (objective === "purchase") return "상품 상세 확인하기";
  if (objective === "benefit") return "혜택 조건 확인하기";
  if (objective === "new-product") return "신상품 자세히 보기";
  return "제품 포인트 더 알아보기";
}

function buildCuts(input: {
  type: VideoHookType;
  duration: VideoDuration;
  analysis: ProductAnalysisSnapshot;
  opening: string;
  bridge: string;
  cta: string;
  requiredPhrases: string[];
}): VideoCut[] {
  const windows = timeWindows(input.duration);
  const product = input.analysis.productName;
  const proof = evidenceFor(input.type, input.analysis);
  const target = input.analysis.targetCustomers[0] || "핵심 고객";
  const required = input.requiredPhrases[0] || "";
  const rows = [
    {
      sceneDescription: hookMessage(input.type, input.analysis).firstScene,
      caption: input.opening,
      narration: input.opening,
      requiredSources: ["제품 대표 이미지 또는 실제 제품 영상"],
    },
    {
      sceneDescription: `${target}이 제품을 사용하는 구체적인 상황을 보여준다.`,
      caption: input.analysis.customerProblems[0] || input.analysis.targetCustomers[0] || product,
      narration: input.bridge,
      requiredSources: ["타깃 사용 상황 컷", "실제 제품 사용 장면"],
    },
    {
      sceneDescription: "확인된 상품 근거를 제품 디테일과 나란히 제시한다.",
      caption: proof,
      narration: `${product}에서 확인된 포인트는 ${proof}입니다.`,
      requiredSources: ["제품 디테일", "상세페이지 확인 근거"],
    },
    {
      sceneDescription: "제품 전체와 CTA를 안전 영역 안에 배치해 마무리한다.",
      caption: compact([required, input.cta], 2).join(" · "),
      narration: input.cta,
      requiredSources: ["제품 엔딩 컷", "투명 배경 브랜드 로고 원본"],
    },
  ];
  return rows.map((row, index) => ({
    id: crypto.randomUUID(),
    cutNumber: index + 1,
    sceneName: `장면 ${index + 1}`,
    startSecond: windows[index][0],
    endSecond: windows[index][1],
    referenceImages: [],
    productionMemo: "",
    ...row,
  }));
}

function removeForbidden(value: string, forbidden: string[]) {
  let next = value;
  for (const phrase of forbidden.map((item) => clean(item, 120)).filter(Boolean)) {
    next = next
      .replaceAll(phrase, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return next;
}

function applyForbidden(concept: VideoConcept, forbidden: string[]) {
  const apply = (value: string) => removeForbidden(value, forbidden);
  return {
    ...concept,
    title: apply(concept.title),
    openingHook: apply(concept.openingHook),
    fullScript: apply(concept.fullScript),
    cta: apply(concept.cta),
    cuts: concept.cuts.map((cut) => ({
      ...cut,
      caption: apply(cut.caption),
      narration: apply(cut.narration),
    })),
  };
}

export function generateGroundedVideoConcepts(input: {
  advertiserName: string;
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  duration: VideoDuration;
  objective: VideoObjective;
  hookTypes?: VideoHookType[];
  existingConcepts?: VideoConcept[];
  now?: Date;
}) {
  const nowDate = input.now || new Date();
  const now = nowDate.toISOString();
  const types = input.hookTypes || hookPriority(input.analysis, input.objective);
  const occupied = (input.existingConcepts || []).map((concept) => concept.materialCode);
  const concepts = types.slice(0, 3).map((type): VideoConcept => {
    const previous = input.existingConcepts?.find((concept) => concept.hookType === type);
    const message = hookMessage(type, input.analysis);
    const cta = objectiveCta(input.objective);
    const cuts = buildCuts({
      type,
      duration: input.duration,
      analysis: input.analysis,
      opening: message.opening,
      bridge: message.bridge,
      cta,
      requiredPhrases: input.guideline.requiredPhrases,
    });
    const concept: VideoConcept = {
      id: previous?.id || crypto.randomUUID(),
      title: message.title,
      hookType: type,
      coreTarget:
        input.analysis.targetCustomers[0] ||
        input.guideline.primaryAudience ||
        "이 상품의 핵심 구매 고객",
      objective: input.objective,
      openingHook: message.opening,
      fullScript: cuts
        .map((cut) => cut.narration)
        .filter(Boolean)
        .join(" "),
      cuts,
      requiredSources: compact([
        ...cuts.flatMap((cut) => cut.requiredSources),
        ...input.analysis.imageUrls.slice(0, 3),
      ]),
      cta,
      productionCautions: compact([
        ...input.analysis.cautionPhrases,
        input.guideline.toneAndManner,
        input.guideline.advertiserRequests,
        input.guideline.designerNotes,
      ]),
      materialCode:
        previous?.materialCode ||
        createVideoMaterialCode({
          advertiserName: input.advertiserName,
          productName: input.analysis.productName,
          hookType: type,
          existingCodes: occupied,
          createdAt: nowDate,
        }),
      generationSource: "grounded-rules",
      generationWarnings: [],
      revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    occupied.push(concept.materialCode);
    return preserveSceneReferences(
      applyForbidden(concept, input.guideline.forbiddenPhrases),
      previous
    );
  });
  return concepts;
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

function parseJson(value: string) {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned) as { concepts?: unknown[] };
}

function textFields(concept: VideoConcept) {
  return [
    concept.title,
    concept.coreTarget,
    concept.openingHook,
    concept.fullScript,
    concept.cta,
    ...concept.requiredSources,
    ...concept.productionCautions,
    ...concept.cuts.flatMap((cut) => [
      cut.sceneDescription,
      cut.caption,
      cut.narration,
      ...cut.requiredSources,
    ]),
  ].join(" ");
}

function allowedNumbers(analysis: ProductAnalysisSnapshot) {
  return new Set(
    [
      analysis.productName,
      analysis.price,
      analysis.originalPrice,
      analysis.discountInfo,
      ...analysis.coreUsps,
      ...analysis.keyFeatures,
      ...analysis.trustSignals,
      analysis.rawDescription,
    ]
      .join(" ")
      .match(/\d[\d,.]*/g)
      ?.map((value) => value.replace(/[,.]/g, "")) || []
  );
}

function unsupportedNumber(concept: VideoConcept, allowed: Set<string>) {
  return (textFields(concept).match(/\d[\d,.]*/g) || [])
    .map((value) => value.replace(/[,.]/g, ""))
    .some((value) => !allowed.has(value));
}

function fromAiConcept(
  raw: unknown,
  fallback: VideoConcept,
  duration: VideoDuration
): VideoConcept | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const cuts = Array.isArray(value.cuts) ? value.cuts : [];
  if (cuts.length < 3 || cuts.length > 8) return null;
  const normalizedCuts: VideoCut[] = cuts.map((cut, index) => {
    const item = (cut || {}) as Record<string, unknown>;
    return {
      id: fallback.cuts[index]?.id || crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName:
        clean(item.sceneName, 160) || fallback.cuts[index]?.sceneName || `장면 ${index + 1}`,
      startSecond: Number(item.startSecond),
      endSecond: Number(item.endSecond),
      sceneDescription: clean(item.sceneDescription, 500),
      caption: clean(item.caption, 240),
      narration: clean(item.narration, 500),
      requiredSources: compact(Array.isArray(item.requiredSources) ? item.requiredSources : [], 6),
      referenceImages: fallback.cuts[index]?.referenceImages || [],
      productionMemo:
        clean(item.productionMemo, 1200) || fallback.cuts[index]?.productionMemo || "",
    };
  });
  if (
    normalizedCuts.some(
      (cut) =>
        !Number.isFinite(cut.startSecond) ||
        !Number.isFinite(cut.endSecond) ||
        cut.startSecond < 0 ||
        cut.endSecond <= cut.startSecond ||
        cut.endSecond > duration
    ) ||
    normalizedCuts.some(
      (cut, index) => index > 0 && cut.startSecond < normalizedCuts[index - 1].endSecond
    ) ||
    normalizedCuts.at(-1)?.endSecond !== duration
  ) {
    return null;
  }
  const concept: VideoConcept = {
    ...fallback,
    title: clean(value.title, 180) || fallback.title,
    coreTarget: clean(value.coreTarget, 180) || fallback.coreTarget,
    openingHook: clean(value.openingHook, 240) || fallback.openingHook,
    fullScript: clean(value.fullScript, 3000) || fallback.fullScript,
    cuts: normalizedCuts,
    requiredSources: compact(
      Array.isArray(value.requiredSources) ? value.requiredSources : fallback.requiredSources,
      10
    ),
    cta: clean(value.cta, 160) || fallback.cta,
    productionCautions: compact(
      Array.isArray(value.productionCautions)
        ? value.productionCautions
        : fallback.productionCautions,
      10
    ),
    generationSource: "openai",
    generationWarnings: [],
  };
  return concept;
}

async function generateWithOpenAI(input: {
  advertiserName: string;
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  duration: VideoDuration;
  objective: VideoObjective;
  fallbacks: VideoConcept[];
  copyGuideContent?: string;
}) {
  const facts = {
    product: input.analysis,
    brandGuideline: input.guideline,
    matchedCopyGuide: input.copyGuideContent || "없음",
    duration: input.duration,
    objective: VIDEO_OBJECTIVE_LABELS[input.objective],
    requiredHookTypes: input.fallbacks.map((item) => ({
      hookType: item.hookType,
      hookLabel: VIDEO_HOOK_LABELS[item.hookType],
    })),
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
      input: `당신은 퍼포먼스 광고 영상 기획자입니다. 아래 확인된 상품 사실만 사용해 서로 다른 고객 심리의 영상 기획안 3개를 작성하세요. 가격·할인·성분·인증·리뷰·효능 수치는 입력에 있을 때만 사용하세요. 후킹 유형을 바꾸지 마세요. 금지 문구는 절대 사용하지 마세요. 각 컷은 제작자가 바로 편집할 수 있게 장면, 자막, 내레이션, 필요 소스를 구체적으로 작성하고 전체 종료 시간이 정확히 ${input.duration}초가 되게 하세요. JSON만 반환하세요.\n\n입력:\n${JSON.stringify(facts)}\n\n출력 스키마: {"concepts":[{"hookType":"requiredHookTypes 중 값","title":"","coreTarget":"","openingHook":"","fullScript":"","cuts":[{"startSecond":0,"endSecond":3,"sceneDescription":"","caption":"","narration":"","requiredSources":[""]}],"requiredSources":[""],"cta":"","productionCautions":[""]}]}`,
      text: { format: { type: "json_object" } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok)
    throw new Error(`OpenAI video script generation failed: HTTP ${response.status}`);
  const parsed = parseJson(responseText(await response.json()));
  const rawConcepts = parsed.concepts || [];
  const allowed = allowedNumbers(input.analysis);
  return input.fallbacks.map((fallback) => {
    const raw = rawConcepts.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).hookType === fallback.hookType
    );
    const candidate = fromAiConcept(raw, fallback, input.duration);
    if (!candidate) {
      return {
        ...fallback,
        generationWarnings: ["AI 응답 구조가 불완전해 근거 기반 대본을 사용했습니다."],
      };
    }
    const forbidden = input.guideline.forbiddenPhrases.filter((phrase) =>
      textFields(candidate).includes(phrase)
    );
    if (forbidden.length || unsupportedNumber(candidate, allowed)) {
      return {
        ...fallback,
        generationWarnings: [
          forbidden.length
            ? "금지 문구가 포함된 AI 결과를 제외하고 근거 기반 대본을 사용했습니다."
            : "확인되지 않은 수치가 포함된 AI 결과를 제외하고 근거 기반 대본을 사용했습니다.",
        ],
      };
    }
    return candidate;
  });
}

export async function generateVideoConcepts(input: {
  advertiserName: string;
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  duration: VideoDuration;
  objective: VideoObjective;
  hookTypes?: VideoHookType[];
  existingConcepts?: VideoConcept[];
}) {
  const fallbacks = generateGroundedVideoConcepts(input);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return fallbacks.map((concept) => ({
      ...concept,
      generationWarnings: ["OPENAI_API_KEY가 없어 확인된 상품 근거 기반 대본을 생성했습니다."],
    }));
  }
  try {
    const copyGuide = await loadCopyGuideForProduct({
      advertiserName: input.advertiserName,
      brandName: input.analysis.brandName,
      productUrl: input.analysis.productUrl,
      category: input.analysis.category,
      productName: input.analysis.productName,
    });
    return await generateWithOpenAI({
      ...input,
      fallbacks,
      copyGuideContent: copyGuide?.content,
    });
  } catch {
    return fallbacks.map((concept) => ({
      ...concept,
      generationWarnings: ["AI 대본 생성에 실패해 확인된 상품 근거 기반 대본을 사용했습니다."],
    }));
  }
}

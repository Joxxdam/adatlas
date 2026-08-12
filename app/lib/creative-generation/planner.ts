import type { BackgroundLibraryItem } from "../background-library/types";
import { recommendBackgrounds } from "../background-library/recommender.ts";
import { getHookCode } from "../creative-assets/code.ts";
import { getAdObjectiveProfile, getCreativeApproachProfile, getGenerationHookTypes, objectiveCta } from "../mvp/adObjective.ts";
import type { AdBrief, CreativeStrategy, ProductInfoForPrompt } from "../mvp/types";
import { analyzeProductUsp } from "../mvp/productUsp.ts";
import { matchKnownProductAsset } from "../creative/knownProductAssets.ts";
import { creativeBlueprints } from "./blueprints.ts";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles.ts";
import { extractNumericTokens } from "./productTruth.ts";
import type {
  BrandProfile,
  CreativeBlueprintId,
  CreativePlan,
  GenerationJob,
  GenerationResult,
  HookPlan,
  ProductTruth,
  SceneAsset,
  ScenePlan,
} from "./types";

export const CREATIVE_PLANNER_VERSION = "creative-planner-v1";
export const SCENE_PROMPT_VERSION = "scene-safe-zone-v1";

function id(prefix: string, index = 0) {
  return `${prefix}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanBenefit(truth: ProductTruth) {
  const claim = truth.verifiedClaims.find((value) => !extractNumericTokens(value).length);
  return claim || truth.product.mainBenefit.replace(/-?\d[\d,.]*(?:\s?(?:%|°c|℃|원|ml|mL|g|kg|개|팩|병|점|배))?/gi, "").replace(/\s+/g, " ").trim();
}

function factIds(truth: ProductTruth, keys: string[]) {
  return truth.facts.filter((item) => keys.some((key) => item.key.startsWith(key))).map((item) => item.id);
}

function exactOffer(truth: ProductTruth) {
  return [truth.product.discountInfo, truth.product.price].filter(Boolean).join(" · ");
}

function creativePlanBrandName(product: ProductInfoForPrompt) {
  return compact(product.brandName || product.advertiserName || product.productName || "브랜드", 12);
}

function cleanCopySignal(value: string, productName = "") {
  const productTokens = productName
    .toLowerCase()
    .match(/[0-9a-z가-힣]+/gi)
    ?.filter((token) => token.length >= 2) || [];
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .split(/\s*[·|•]\s*|[.!?]\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((left, right) => {
      const score = (part: string) => {
        let value = 0;
        if (/쿨링|상쾌|보습|향|성분|원료|비건|천연|민트|티트리|레몬|라임|코코넛|시어|핏|실루엣|구성|원산지|식감|풍미/i.test(part)) value += 20;
        if (/리뷰|후기|step|구성\s*선택|전체\s*리뷰|너무|좋아요|중요부위/i.test(part)) value -= 22;
        if (productName && part.includes(productName)) value -= 12;
        value += productTokens.filter((token) => part.toLowerCase().includes(token)).length;
        if ([...part.replace(/\s+/g, "")].length <= 52) value += 5;
        return value;
      };
      return score(right) - score(left);
    })[0] || "";
}

function compact(value: string, maxChars: number) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if ([...source.replace(/\s+/g, "")].length <= maxChars) return source;
  const leadingClause = source.split(/[,;:]/).map((part) => part.trim()).filter(Boolean)[0] || source;
  if ([...leadingClause.replace(/\s+/g, "")].length <= maxChars) return leadingClause;
  const words = leadingClause.split(/\s+/);
  const result: string[] = [];
  for (const word of words) {
    if ([...[...result, word].join(" ").replace(/\s+/g, "")].length > maxChars) break;
    result.push(word);
  }
  return result.join(" ") || source;
}

function productCopySignals(truth: ProductTruth) {
  const product = truth.product;
  const analysis = analyzeProductUsp(product);
  const verified = truth.verifiedClaims
    .map((claim) => cleanCopySignal(claim, product.productName))
    .filter(Boolean);
  const source = [
    ...verified,
    ...analysis.uspSignals,
    ...(product.ingredients || []),
    product.mainBenefit,
  ].map((value) => cleanCopySignal(value, product.productName)).filter(Boolean);
  const unique = Array.from(new Set(source));
  const find = (pattern: RegExp) => unique.find((value) => pattern.test(value));
  const productText = `${product.productName} ${product.category} ${unique.join(" ")}`;
  const personalCare = /샤워|바디|세정|쿨링|보습|향|화장|뷰티|스킨/i.test(productText);
  const fashion = /패션|의류|원피스|블라우스|팬츠|스커트|핏|실루엣|코디/i.test(productText);
  const food = /식품|한우|고기|과일|채소|농산|수산|맛|식감|풍미/i.test(productText);
  const primary = compact(find(/쿨링|상쾌|보습|향|성분|원료|핏|실루엣|구성|원산지|식감|풍미/i) || unique[0] || product.productName, 32);
  const ingredients = compact(
    Array.from(new Set((product.ingredients || []).flatMap((value) =>
      String(value).match(/민트|티트리|레몬|라임|코코넛|시어버터|시어|멘톨|국내산|한우/gi) || []
    ))).slice(0, 3).join(" · ") || find(/민트|티트리|레몬|라임|코코넛|시어|멘톨|원료|성분/i) || primary,
    24
  );
  const sensory = compact(find(/쿨링|상쾌|시원|보습|촉촉|향|부드|식감|풍미|핏/i) || primary, 24);
  const situation = personalCare
    ? /쿨링|시원|상쾌|민트/i.test(productText)
      ? "운동 후에도 열감이 남는 순간"
      : "샤워 뒤에도 개운함이 아쉬운 순간"
    : fashion
      ? "출근부터 주말 약속까지 입을 옷이 필요한 순간"
      : food
        ? "오늘 식탁의 메뉴가 고민되는 순간"
        : `${truth.product.category || "상품"} 선택이 어려운 순간`;
  const problem = personalCare
    ? /쿨링|시원|상쾌|민트/i.test(productText)
      ? "씻고 나와도 금세 다시 더워진다면"
      : /보습|촉촉|건조/i.test(productText)
        ? "샤워 뒤 당김이 신경 쓰인다면"
        : "샤워 뒤 개운함이 오래가지 않는다면"
    : fashion
      ? "예뻐 보여도 실제 핏이 늘 걱정된다면"
      : food
        ? "가격만 보고 골랐다가 맛이 아쉬웠다면"
        : "비슷한 상품 사이에서 고르기 어렵다면";
  return { analysis, primary, ingredients, sensory, situation, problem, personalCare, fashion, food };
}

function hookBody(params: {
  hookType: string;
  fallback: string;
  signals: ReturnType<typeof productCopySignals>;
  offer: string;
}) {
  const { hookType, fallback, signals, offer } = params;
  if ((hookType === "price-benefit" || hookType === "price-value") && offer) {
    return `${offer}, 확인된 가격으로 비교하세요`;
  }
  if (hookType === "problem-solution") {
    return signals.personalCare
      ? `${compact(signals.sensory, 12)}, 민트 샤워로 바꿔보세요`
      : `${signals.primary}, 불편을 줄일 선택 기준`;
  }
  if (hookType === "sensory") return `${signals.sensory}, 쓰는 순간 느껴지는 차이`;
  if (hookType === "lifestyle" || hookType === "empathy-situation") {
    return signals.personalCare
      ? `${signals.ingredients}로 완성하는 상쾌한 사용감`
      : `${signals.primary}, 필요한 순간의 선택`;
  }
  if (hookType === "feature-usp" || hookType === "usp-proof" || hookType === "proof-data") {
    return signals.personalCare
      ? `${signals.ingredients}, 상품 차이를 만드는 조합`
      : `${signals.primary}, 상세페이지에서 확인한 차이`;
  }
  if (hookType === "curiosity") return `${signals.primary}, 상세페이지에서 답을 확인하세요`;
  return fallback;
}

export function buildHookPlans(truth: ProductTruth, adBrief?: AdBrief): HookPlan[] {
  const signals = productCopySignals(truth);
  const benefit = signals.primary || cleanBenefit(truth);
  const target = truth.product.targetCustomer || "이 상품이 필요한 고객";
  const offer = exactOffer(truth);
  const objectiveProfile = getAdObjectiveProfile(adBrief?.adObjective);
  const approachProfile = getCreativeApproachProfile(adBrief?.creativeIntensity);
  const plannedCta = objectiveCta(adBrief?.adObjective, Boolean(offer));
  const plans: Array<Omit<HookPlan, "id" | "numericTokens">> = [
    {
      blueprintId: "problem-solution-split",
      hookType: "problem-solution",
      title: "문제에서 해결로",
      headline: signals.problem,
      body: `${compact(signals.sensory, 12)}, 민트 샤워로 바꿔보세요`,
      proof: "",
      offer,
      cta: plannedCta,
      audience: target,
      sceneIntent: "고객 문제 상황과 해결 제품을 한 화면에서 명확히 대비",
      factIds: factIds(truth, ["product-name", "category", "main-benefit", "price", "discount"]),
    },
    {
      blueprintId: "editorial-story",
      hookType: "editorial-story",
      title: "상황으로 읽히는 이야기",
      headline: signals.situation,
      body: signals.personalCare
        ? `${signals.ingredients}로 완성하는 상쾌한 사용감`
        : `${benefit}, 필요한 순간의 선택 기준`,
      proof: "",
      offer,
      cta: plannedCta,
      audience: target,
      sceneIntent: "에디토리얼 상단 카피와 실사용 장면의 자연스러운 연결",
      factIds: factIds(truth, ["product-name", "verified-benefit", "price", "discount"]),
    },
    {
      blueprintId: "chat-ugc",
      hookType: "review-ugc",
      title: "대화처럼 발견",
      headline: signals.personalCare
        ? `샤워하고 나왔는데\n왜 아직도 덥지?`
        : `써보니 알겠다는 말,\n어떤 차이였을까요?`,
      body: signals.personalCare
        ? `${signals.sensory}을 찾는다면 민트 샤워로`
        : `${benefit}, 실제 선택 기준으로 확인하세요`,
      proof: "상세페이지의 상품 정보를 확인하세요",
      offer: "",
      cta: plannedCta,
      audience: target,
      sceneIntent: "실제 제품 사진을 중심으로 한 메신저 대화형 네이티브 콘텐츠",
      factIds: factIds(truth, ["product-name", "main-benefit"]),
    },
    {
      blueprintId: "comparison-versus",
      hookType: "comparison",
      title: "선택 기준 비교",
      headline: signals.personalCare
        ? `씻기만 하는 샤워와\n기분까지 깨우는 샤워`
        : `비슷해 보여도\n선택 기준은 달라야 하니까`,
      body: signals.personalCare
        ? `${signals.ingredients}, 사용감부터 다르게`
        : `${benefit}, 차이를 만드는 선택 기준`,
      proof: "상세페이지 확인 정보",
      offer,
      cta: plannedCta,
      audience: target,
      sceneIntent: "일반적인 고민 상태와 제품 선택 후 기대 장면을 분할 비교",
      factIds: factIds(truth, ["product-name", "main-benefit", "price", "discount"]),
    },
    {
      blueprintId: "product-hero-lifestyle",
      hookType: "product-hero",
      title: "제품을 가장 크게",
      headline: signals.personalCare
        ? `샤워하는 순간,\n상쾌함의 온도를 바꾸다`
        : `${benefit}, 한 번에 기억될 차이`,
      body: signals.personalCare
        ? `${signals.ingredients}의 감각을 담은 샤워젤`
        : benefit,
      proof: "",
      offer,
      cta: plannedCta,
      audience: target,
      sceneIntent: "브랜드 장면과 큰 제품 히어로, 짧은 혜택 메시지",
      factIds: factIds(truth, ["product-name", "main-benefit", "price", "discount"]),
    },
    {
      blueprintId: "proof-data",
      hookType: "proof-data",
      title: "확인된 정보만",
      headline: signals.personalCare
        ? `${signals.ingredients},\n상쾌함에는 이유가 있으니까`
        : `${benefit}, 말보다 기준으로 확인하세요`,
      body: signals.personalCare
        ? `${signals.sensory}을 위한 확인된 상품 정보`
        : benefit,
      proof: truth.product.price || "상세페이지 확인 정보",
      offer: truth.product.discountInfo || "",
      cta: plannedCta,
      audience: target,
      sceneIntent: "검증된 가격·구성·혜택만 큰 정보 카드로 표현",
      factIds: factIds(truth, ["product-name", "price", "discount", "verified-benefit", "main-benefit"]),
    },
  ];
  const context = truth.product.creativeContext;
  const notes = context?.appliedContentNotes || [];
  const preferredHookNotes = notes
    .filter((note) => note.type === "PREFERRED_HOOK" && !note.prohibited)
    .map((note) => note.content.trim())
    .filter(Boolean);
  const avoidedHookNotes = notes
    .filter((note) => note.type === "AVOIDED_HOOK")
    .map((note) => note.content.trim().toLowerCase())
    .filter(Boolean);
  const isAvoidedHook = (hookType: string) => {
    const normalizedHook = hookType.trim().toLowerCase();
    const hookCode = getHookCode(normalizedHook);
    return avoidedHookNotes.some((instruction) =>
      instruction === normalizedHook
      || instruction.includes(`[hook:${normalizedHook}]`)
      || instruction.startsWith(`${normalizedHook} `)
      || (hookCode !== "ETC" && getHookCode(instruction) === hookCode)
    );
  };
  const preferred = Array.from(new Set([
    ...preferredHookNotes,
    ...(adBrief ? getGenerationHookTypes(adBrief) : []),
    ...(context?.recommendedHookTypes || []),
    "problem-solution",
    "usp-proof",
    ...(context?.reviewInsightSummaries?.length ? ["review-ugc"] : ["editorial-story"]),
    ...(truth.product.price || truth.product.discountInfo ? ["price-value"] : ["comparison"]),
    "empathy-situation",
    ...(context?.opportunityType === "RISING_PRODUCT" || context?.opportunityType === "NEW_PRODUCT_TEST" ? ["urgency"] : ["proof-data"]),
    "product-hero",
    "proof-data",
    "comparison",
  ])).filter((hookType) => !isAvoidedHook(hookType)).slice(0, 6);
  const hookLabels: Record<string, string> = {
    "problem-solution": "문제 해결 가설",
    "usp-proof": "상품 USP 가설",
    "review-ugc": "후기 근거 가설",
    "editorial-story": "정보 탐색 가설",
    "price-value": "가격·구성 가설",
    comparison: "선택 기준 가설",
    "empathy-situation": "고객 공감 가설",
    urgency: "시급성 가설",
    "proof-data": "사실 근거 가설",
    "price-benefit": "구매 혜택 가설",
    "feature-usp": "상품 차별점 가설",
    "social-proof": "신뢰 근거 가설",
    curiosity: "첫 관심 가설",
    lifestyle: "사용 장면 가설",
    "product-hero": "상품 인지 가설",
    "brand-story": "브랜드 기억 가설",
    sensory: "감각 경험 가설",
  };
  const uspNote = notes.find((note) => note.type === "PRODUCT_USP" && !note.prohibited)?.content.trim();
  const toneNote = notes.find((note) => ["TONE_OF_VOICE", "TONE_AND_MANNER"].includes(note.type) && !note.prohibited)?.content.trim();
  return plans.map((plan, index) => {
    const hookType = preferred[index] || plan.hookType;
    const planHeadline =
      (hookType === "price-benefit" || hookType === "price-value") && offer
        ? `${offer}, 상쾌한 샤워를 고를 이유`
        : hookType === "sensory"
          ? signals.personalCare
            ? `샤워하는 순간,\n민트 바람이 터지는 듯`
            : `${signals.sensory}, 쓰는 순간 느껴지는 차이`
          : hookType === "lifestyle" || hookType === "empathy-situation"
            ? signals.situation
            : hookType === "feature-usp" || hookType === "usp-proof"
              ? signals.personalCare
                ? `${signals.ingredients},\n상쾌함을 만드는 조합`
                : `${benefit}, 차이를 만드는 기준`
              : hookType === "curiosity"
                ? signals.personalCare
                  ? `평범한 샤워가\n유독 아쉬웠던 이유`
                  : `${benefit}, 왜 차이가 날까요?`
                : hookType === "brand-story"
                  ? signals.personalCare
                    ? `오리지널소스가\n샤워를 깨우는 방식`
                    : `${creativePlanBrandName(truth.product)}, 기억할 한 가지 차이`
                  : plan.headline;
    const objectiveHeadline =
      adBrief?.adObjective === "awareness" && index === 0
        ? signals.personalCare
          ? `오리지널소스,\n샤워를 깨우는 민트 감각`
          : `${creativePlanBrandName(truth.product)},\n${benefit}`
        : adBrief?.adObjective === "retargeting" && index === 0
          ? `다시 볼 이유,\n${benefit}`
          : adBrief?.adObjective === "signup" && index === 0
            ? `처음이라면,\n${benefit}부터 비교하세요`
            : planHeadline;
    const nextPlan = {
      ...plan,
      hookType,
      title: hookLabels[hookType] || plan.title,
      headline: objectiveHeadline,
      body: hookBody({
        hookType,
        fallback: index === 1 && uspNote ? [plan.body, uspNote].filter(Boolean).join(" · ") : plan.body,
        signals,
        offer,
      }),
      offer: adBrief?.creativeIntensity === "brand" && index < 4 ? "" : plan.offer,
      sceneIntent: [
        plan.sceneIntent,
        adBrief ? `광고 목표: ${objectiveProfile.label}` : "",
        adBrief ? `제작 방식: ${approachProfile.label} — ${approachProfile.visualDirection}` : "",
        toneNote ? `톤 참고: ${toneNote}` : "",
      ].filter(Boolean).join(" · "),
    };
    const text = [nextPlan.headline, nextPlan.body, nextPlan.proof, nextPlan.offer, nextPlan.cta].join(" ");
    return { ...nextPlan, id: `hook-${index + 1}-${plan.blueprintId}`, numericTokens: extractNumericTokens(text) };
  });
}

export function buildCreativePlan(
  truth: ProductTruth,
  options: { logoPath?: string; adBrief?: AdBrief } = {}
): CreativePlan {
  const brandProfile = withRequestedLogo(matchBrandProfile(truth.product), options.logoPath);
  const categoryProfile = matchCategoryProfile(truth.product);
  const hookPlans = buildHookPlans(truth, options.adBrief);
  return {
    id: id("creative-plan"),
    productTruth: truth,
    brandProfile,
    categoryProfile,
    hookPlans,
    blueprintIds: creativeBlueprints.map((item) => item.id),
    adBrief: options.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: CREATIVE_PLANNER_VERSION,
  };
}

function strategyFor(plan: HookPlan, product: ProductInfoForPrompt): CreativeStrategy {
  const map: Record<CreativeBlueprintId, Pick<CreativeStrategy, "hookType" | "backgroundHookType">> = {
    "problem-solution-split": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "editorial-story": { hookType: "lifestyle", backgroundHookType: "situation" },
    "chat-ugc": { hookType: "social-proof", backgroundHookType: "review_ugc" },
    "comparison-versus": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "product-hero-lifestyle": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
    "proof-data": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
  };
  return {
    id: plan.id,
    title: plan.title,
    ...map[plan.blueprintId],
    headline: plan.headline,
    subCopy: plan.body,
    keyAppeal: product.mainBenefit,
    sceneDescription: plan.sceneIntent,
    mood: ["고대비", "상품 중심", "광고 집행형"],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: [plan.hookType, product.category, product.mainBenefit].filter(Boolean),
    appeal: plan.body,
    mainCopy: plan.headline,
    audience: plan.audience,
    explanation: plan.sceneIntent,
    mainHookAngle: plan.hookType,
    coreAppealPoint: plan.body,
    audienceFit: plan.audience,
    referenceFit: plan.blueprintId,
    suggestedVisualEmphasis: "actual-product-large",
    risk: "검증되지 않은 수치 사용 금지",
    expectedCustomerProblem: product.mainBenefit,
    purchaseBarrierResponse: "상품 사실과 실제 이미지를 우선 표시",
    recommendedTone: "사실 중심",
    inferredEvidence: plan.factIds,
    matchedReferenceIds: [],
    matchedReferencePatterns: [plan.blueprintId],
  };
}

function toSceneAsset(item: BackgroundLibraryItem): SceneAsset {
  return {
    id: item.id,
    file: item.file,
    sourceType: "library",
    assetType: item.assetType,
    scene: item.scene,
    category: item.category,
    includesPerson: item.includesPerson,
    textSafeArea: item.textSafeArea,
    productPosition: item.productPosition,
    license: {
      sourceName: item.sourceName,
      sourcePageUrl: item.sourcePageUrl,
      licenseUrl: item.licenseUrl,
      authorName: item.authorName,
    },
  };
}

export function planScenes(
  creativePlan: CreativePlan,
  library: BackgroundLibraryItem[],
  paidImageGenerationAllowed = false
): ScenePlan[] {
  const used = new Set<string>();
  const designNotes = (creativePlan.productTruth.product.creativeContext?.appliedContentNotes || [])
    .filter((note) => ["IMAGE_RULE", "PRODUCT_IMAGE_RULE", "BACKGROUND_STYLE", "LAYOUT_RULE", "DESIGN_GUIDELINE"].includes(note.type))
    .map((note) => note.content);
  const fallback = library.find((item) => item.enabled !== false) || null;
  const knownAsset = matchKnownProductAsset(creativePlan.productTruth.product);
  const dedicatedLibrary = knownAsset
    ? library.filter((item) => item.enabled !== false && item.file.startsWith(knownAsset.backgroundPrefix))
    : [];
  return creativePlan.hookPlans.map((hookPlan, index) => {
    const recommendationPool = dedicatedLibrary.length ? dedicatedLibrary : library;
    const recommendation = recommendBackgrounds(recommendationPool, {
      product: creativePlan.productTruth.product,
      hook: strategyFor(hookPlan, creativePlan.productTruth.product),
      limit: 6,
      excludeIds: Array.from(used),
      recommendationPage: index,
    }).recommendations.find((item) => !used.has(item.background.id));
    const selected = recommendation?.background || fallback;
    if (!selected) throw new Error("사용 가능한 배경 장면이 없습니다.");
    used.add(selected.id);
    return {
      id: `scene-${index + 1}-${selected.id}`,
      blueprintId: hookPlan.blueprintId,
      sceneAsset: toSceneAsset(selected),
      promptVersion: SCENE_PROMPT_VERSION,
      provider: "library",
      generated: false,
      paidGenerationAllowed: paidImageGenerationAllowed,
      reason: [
        dedicatedLibrary.length ? "등록된 상품 전용 배경" : "",
        recommendation?.reasons.join(" · ") || "카테고리 안전 배경 fallback",
        ...designNotes,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

export function createGenerationJob(params: {
  truth: ProductTruth;
  creativePlan: CreativePlan;
  scenes: ScenePlan[];
  concurrency?: number;
  paidImageGenerationEnabled?: boolean;
  planningMs: number;
}): GenerationJob {
  const jobId = id("creative-job");
  const now = new Date().toISOString();
  const results: GenerationResult[] = params.creativePlan.hookPlans.map((hookPlan, index) => ({
    id: `result-${index + 1}-${hookPlan.blueprintId}`,
    order: index + 1,
    blueprintId: hookPlan.blueprintId,
    blueprintLabel: creativeBlueprints.find((item) => item.id === hookPlan.blueprintId)!.label,
    status: "pending",
    hookPlan,
    scenePlan: params.scenes[index],
    attempts: 0,
  }));
  return {
    id: jobId,
    status: "pending",
    productTruth: params.truth,
    creativePlan: params.creativePlan,
    results,
    concurrency: Math.max(1, Math.min(3, params.concurrency || 2)),
    paidImageGenerationEnabled: Boolean(params.paidImageGenerationEnabled),
    createdAt: now,
    updatedAt: now,
    timing: { planningMs: params.planningMs },
    errors: [],
    version: "generation-job-v2",
  };
}

export function brandPalette(brand: BrandProfile, fallback: string[]) {
  const palette = [...brand.primaryColors, ...brand.secondaryColors, ...fallback].filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  return {
    background: palette[1] || "#101827",
    foreground: "#ffffff",
    accent: palette[0] || "#08d8b6",
    secondary: palette[2] || "#ffcf33",
  };
}

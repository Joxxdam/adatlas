import crypto from "node:crypto";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader.ts";
import type { BrandGuideline, ProductAnalysisSnapshot, VideoConcept, VideoCut, VideoDuration, VideoHookType, VideoObjective, VideoCreativeStyle, ProductLockedAsset } from "./types.ts";
import { preserveSceneReferences } from "./script.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";
import { buildVideoHookCandidates, buildVisualBible, conceptScoreFromHook, selectTopDistinctHooks, validateVideoPlan } from "./planningPipeline.ts";
import { buildVideoPlannerPrompt } from "./prompts.ts";

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

function hookPriority(analysis: ProductAnalysisSnapshot, objective: VideoObjective): VideoHookType[] {
  const scores: Array<[VideoHookType, number]> = [
    ["problem-solution", analysis.customerProblems.length ? 92 : objective === "interest" ? 62 : 30],
    ["price-benefit", analysis.price || analysis.discountInfo ? (objective === "benefit" ? 110 : 90) : 5],
    ["feature-usp", analysis.coreUsps.length || analysis.keyFeatures.length ? 100 : 35],
    ["sensory-scene", /향|맛|촉감|상쾌|시원|부드|바삭|쫀득|산뜻|색감|질감/i.test([...analysis.coreUsps, ...analysis.keyFeatures].join(" ")) ? 88 : 42],
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
  if (type === "problem-solution") return analysis.customerProblems[0] || `${product}이 필요한 상황`;
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
  const messages: Record<VideoHookType, { title: string; opening: string; bridge: string; firstScene: string }> = {
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
    "loss-aversion": {
      title: "놓치고 있던 비용을 먼저 보여주는 기획",
      opening: `${problem}, 계속 넘기면 더 아까운 건 따로 있습니다.`,
      bridge: `${product}의 확인된 조건으로 놓치고 있던 선택 기준을 설명합니다.`,
      firstScene: "고객이 반복해서 손해를 체감하는 실제 사용 장소와 행동을 보여준다.",
    },
    "unexpected-comparison": {
      title: "예상 밖의 비교로 차이를 보이는 기획",
      opening: `${evidence}, 익숙한 선택과 나란히 놓으면 다르게 보입니다.`,
      bridge: `${product}의 확인된 근거를 같은 조건에서 비교합니다.`,
      firstScene: "두 선택의 결과가 다른 실제 상황을 같은 화면 안에서 대비한다.",
    },
    "origin-material": {
      title: "원산지와 원물의 이유를 따라가는 기획",
      opening: `${usp}, 어디서 시작됐는지 보면 이유가 보입니다.`,
      bridge: `${product}의 확인된 원산지·원료 정보를 사용 맥락과 연결합니다.`,
      firstScene: "원물이나 성분이 등장하는 구체적인 장소와 손동작부터 보여준다.",
    },
    "before-after": {
      title: "사용 전후의 행동 변화를 따라가는 기획",
      opening: `${problem}, 바뀌는 건 행동에서 먼저 보입니다.`,
      bridge: `${product} 사용 전후의 구체적인 상황 변화를 보여줍니다.`,
      firstScene: "같은 인물과 장소에서 사용 전의 불편한 행동을 먼저 포착한다.",
    },
    "seasonal-situation": {
      title: "계절과 상황의 순간을 잡는 기획",
      opening: `${evidence}, 바로 이 순간 필요한 이유가 있습니다.`,
      bridge: `${product}이 필요한 계절·행사·일상 상황을 구체화합니다.`,
      firstScene: "날씨나 행사 상황을 알 수 있는 배경과 인물의 즉각적인 반응을 보여준다.",
    },
    "myth-busting": {
      title: "익숙한 상식을 뒤집는 기획",
      opening: `${problem}, 익숙한 답이 늘 맞는 건 아닙니다.`,
      bridge: `${product}의 확인된 근거로 기존 선택 기준을 다시 봅니다.`,
      firstScene: "익숙한 해결 방법이 기대와 다르게 끝나는 실제 행동을 먼저 보여준다.",
    },
    "user-monologue": {
      title: "실제 사용자 독백으로 시작하는 기획",
      opening: `저도 ${problem} 때문에 매번 망설였어요.`,
      bridge: `사용자가 ${product}의 확인된 차이를 발견하는 흐름으로 말합니다.`,
      firstScene: "사용자가 실제 생활 공간에서 카메라를 보며 문제 행동을 직접 보여준다.",
    },
  };
  return messages[type];
}

function timeWindows(duration: VideoDuration) {
  if (duration === 15)
    return [
      [0, 3],
      [3, 7],
      [7, 10],
      [10, 13],
      [13, 15],
    ] as const;
  if (duration === 20)
    return [
      [0, 3],
      [3, 7],
      [7, 12],
      [12, 18],
      [18, 20],
    ] as const;
  if (duration === 30)
    return [
      [0, 3],
      [3, 7],
      [7, 12],
      [12, 22],
      [22, 30],
    ] as const;
  return [
    [0, 3],
    [3, 7],
    [7, 12],
    [12, 30],
    [30, 60],
  ] as const;
}

function objectiveCta(objective: VideoObjective) {
  if (objective === "purchase") return "상품 상세 확인하기";
  if (objective === "retargeting") return "다시 상품 확인하기";
  if (objective === "usp") return "제품 차이 확인하기";
  if (objective === "review-ugc") return "후기와 상품 확인하기";
  if (objective === "new-customer-hook") return "처음 보는 제품 자세히 보기";
  if (objective === "benefit") return "혜택 조건 확인하기";
  if (objective === "new-product") return "신상품 자세히 보기";
  return "제품 포인트 더 알아보기";
}

function buildCuts(input: { type: VideoHookType; duration: VideoDuration; analysis: ProductAnalysisSnapshot; opening: string; bridge: string; cta: string; requiredPhrases: string[] }): VideoCut[] {
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
      sceneFormat: "실사 후킹 숏",
      cameraComposition: "세로 9:16 초근접 또는 문제 상황의 강한 클로즈업, 피사체는 중앙 안전 영역에 둔다.",
      motionDirection: "0.5초 안에 손동작이나 카메라 푸시인으로 시선을 멈춘다.",
      transition: "문제 행동의 방향을 이어 다음 장면으로 하드 매치컷",
    },
    {
      sceneDescription: `${target}이 제품을 사용하는 구체적인 상황을 보여준다.`,
      caption: input.analysis.customerProblems[0] || input.analysis.targetCustomers[0] || product,
      narration: input.bridge,
      requiredSources: ["타깃 사용 상황 컷", "실제 제품 사용 장면"],
      sceneFormat: "문제 상황 실사",
      cameraComposition: "인물의 불편한 행동과 표정을 허리 위 미디엄 숏으로 포착한다.",
      motionDirection: "인물의 시선과 손동작이 제품 공개 방향으로 이동한다.",
      transition: "행동 중간에 컷해 제품 등장으로 연결",
    },
    {
      sceneDescription: "업로드한 상품 원본을 훼손하지 않고 정면 라벨이 보이도록 첫 제품 공개를 만든다.",
      caption: `${product}, 답은 제품에 있습니다`,
      narration: `${product}을 원본 그대로 확인해 보세요.`,
      requiredSources: ["업로드한 상품 원본 이미지", "제품 정면 합성 여백"],
      sceneFormat: "원본 제품 합성",
      cameraComposition: "제품 원본을 화면 중앙 45~55% 크기로 배치하고 라벨 정면을 유지한다.",
      motionDirection: "배경만 느리게 이동하고 제품 원본은 안정적으로 고정한다.",
      transition: "문제 장면의 손 위치와 제품 중심을 맞춘 매치컷",
    },
    {
      sceneDescription: "확인된 상품 근거를 제품 디테일과 나란히 제시한다.",
      caption: proof,
      narration: `${product}에서 확인된 포인트는 ${proof}입니다.`,
      requiredSources: ["제품 디테일", "상세페이지 확인 근거"],
      sceneFormat: "근거 설명 합성",
      cameraComposition: "제품 원본은 우측 하단에 유지하고 좌측 안전 영역에 근거 하나만 표시한다.",
      motionDirection: "근거 텍스트가 제품을 가리지 않게 짧게 등장하고 제품으로 시선을 유도한다.",
      transition: "근거 키워드를 제품 라벨 위치로 축소하며 전환",
    },
    {
      sceneDescription: "제품 전체와 CTA를 안전 영역 안에 배치해 마무리한다.",
      caption: compact([required, input.cta], 2).join(" · "),
      narration: input.cta,
      requiredSources: ["제품 엔딩 컷", "투명 배경 브랜드 로고 원본"],
      sceneFormat: "제품 엔딩·CTA",
      cameraComposition: "제품 원본 정면을 중앙에 고정하고 CTA는 하단 18% 안전 영역 위에 배치한다.",
      motionDirection: "제품에 짧은 푸시인 후 CTA를 1초 이상 고정한다.",
      transition: "종료 프레임 고정",
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
    generationPrompt: `${row.sceneDescription} ${row.cameraComposition} ${row.motionDirection} 세로형 광고 영상, 실제 재질, 읽을 수 없는 텍스트나 왜곡된 제품을 만들지 않는다.`,
    productLockInstruction:
      index >= 2
        ? {
            useOriginalComposite: true,
            position: index === 3 ? "우측 하단" : "중앙",
            size: index === 4 ? "화면 높이의 52%" : "화면 높이의 45~55%",
            cameraAngle: "업로드 원본 각도를 그대로 유지",
            handInteraction: "원본에 손이 없으면 새 손으로 제품을 가리지 않음",
            labelVisibility: "로고·라벨·상품명·표기 수치가 가려지지 않게 정면 노출",
            matchCut: index === 2 ? "직전 손동작의 끝점과 제품 중심을 연결" : "제품 중심축 유지",
            editMargin: "제품 외곽 8% 이상의 합성 여백 확보",
          }
        : undefined,
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

export function generateGroundedVideoConcepts(input: { advertiserName: string; analysis: ProductAnalysisSnapshot; guideline: BrandGuideline; duration: VideoDuration; objective: VideoObjective; hookTypes?: VideoHookType[]; existingConcepts?: VideoConcept[]; creativeStyle?: VideoCreativeStyle; productLockedAsset?: ProductLockedAsset; now?: Date }) {
  const nowDate = input.now || new Date();
  const now = nowDate.toISOString();
  const hookCandidates = buildVideoHookCandidates(input.analysis);
  const selectedHooks = selectTopDistinctHooks(hookCandidates, 3);
  const types = input.hookTypes || (selectedHooks.length === 3 ? selectedHooks.map((candidate) => candidate.hookType) : hookPriority(input.analysis, input.objective));
  const occupied = (input.existingConcepts || []).map((concept) => concept.materialCode);
  const concepts = types.slice(0, 3).map((type): VideoConcept => {
    const previous = input.existingConcepts?.find((concept) => concept.hookType === type);
    const message = hookMessage(type, input.analysis);
    const hookCandidate = hookCandidates.find((candidate) => candidate.hookType === type);
    const cta = objectiveCta(input.objective);
    const cuts = buildCuts({
      type,
      duration: input.duration,
      analysis: input.analysis,
      opening: hookCandidate?.hook || message.opening,
      bridge: message.bridge,
      cta,
      requiredPhrases: input.guideline.requiredPhrases,
    });
    const concept: VideoConcept = {
      id: previous?.id || crypto.randomUUID(),
      title: message.title,
      hookType: type,
      coreTarget: input.analysis.targetCustomers[0] || input.guideline.primaryAudience || "이 상품의 핵심 구매 고객",
      objective: input.objective,
      openingHook: message.opening,
      fullScript: cuts
        .map((cut) => cut.narration)
        .filter(Boolean)
        .join(" "),
      cuts,
      requiredSources: compact([...cuts.flatMap((cut) => cut.requiredSources), ...input.analysis.imageUrls.slice(0, 3)]),
      cta,
      productionCautions: compact([...input.analysis.cautionPhrases, input.guideline.toneAndManner, input.guideline.advertiserRequests, input.guideline.designerNotes]),
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
      customerProblem: hookCandidate?.customerProblem || input.analysis.customerProblems[0] || "",
      usp: input.analysis.coreUsps[0] || input.analysis.keyFeatures[0] || "",
      creativeStyle: input.creativeStyle || "auto",
      narrativeSummary: "첫 3초에 구체적인 문제나 근거로 멈추게 한 뒤 문제 상황→원본 제품 공개→검증 근거→CTA로 연결합니다.",
      recommendationReason: hookCandidate ? `후킹 점수 ${hookCandidate.score.total}점이며 상품 근거와 시각화 가능성이 높아 상위안으로 선정했습니다.` : "확인된 상품 근거를 직접 장면화할 수 있어 선정했습니다.",
      claimsToVerify: (input.analysis.unsupportedClaims || []).map((claim) => claim.value),
      score: hookCandidate ? conceptScoreFromHook(hookCandidate) : undefined,
      visualBible: buildVisualBible(input.analysis, input.creativeStyle || "auto"),
    };
    concept.validation = validateVideoPlan(concept, input.analysis, input.duration);
    occupied.push(concept.materialCode);
    return preserveSceneReferences(applyForbidden(concept, input.guideline.forbiddenPhrases), previous);
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
  return [concept.title, concept.coreTarget, concept.openingHook, concept.fullScript, concept.cta, ...concept.requiredSources, ...concept.productionCautions, ...concept.cuts.flatMap((cut) => [cut.sceneDescription, cut.caption, cut.narration, ...cut.requiredSources])].join(" ");
}

function allowedNumbers(analysis: ProductAnalysisSnapshot) {
  return new Set(
    [analysis.productName, analysis.price, analysis.originalPrice, analysis.discountInfo, ...analysis.coreUsps, ...analysis.keyFeatures, ...analysis.trustSignals, analysis.rawDescription]
      .join(" ")
      .match(/\d[\d,.]*/g)
      ?.map((value) => value.replace(/[,.]/g, "")) || []
  );
}

function unsupportedNumber(concept: VideoConcept, allowed: Set<string>) {
  return (textFields(concept).match(/\d[\d,.]*/g) || []).map((value) => value.replace(/[,.]/g, "")).some((value) => !allowed.has(value));
}

function fromAiConcept(raw: unknown, fallback: VideoConcept, duration: VideoDuration): VideoConcept | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const cuts = Array.isArray(value.cuts) ? value.cuts : [];
  if (cuts.length < 5 || cuts.length > 8) return null;
  const normalizedCuts: VideoCut[] = cuts.map((cut, index) => {
    const item = (cut || {}) as Record<string, unknown>;
    return {
      id: fallback.cuts[index]?.id || crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName: clean(item.sceneName, 160) || fallback.cuts[index]?.sceneName || `장면 ${index + 1}`,
      startSecond: Number(item.startSecond),
      endSecond: Number(item.endSecond),
      sceneDescription: clean(item.sceneDescription, 500),
      caption: clean(item.caption, 240),
      narration: clean(item.narration, 500),
      requiredSources: compact(Array.isArray(item.requiredSources) ? item.requiredSources : [], 6),
      referenceImages: fallback.cuts[index]?.referenceImages || [],
      productionMemo: clean(item.productionMemo, 1200) || fallback.cuts[index]?.productionMemo || "",
      sceneFormat: clean(item.sceneFormat, 160) || fallback.cuts[index]?.sceneFormat,
      cameraComposition: clean(item.cameraComposition, 1000) || fallback.cuts[index]?.cameraComposition,
      motionDirection: clean(item.motionDirection, 1000) || fallback.cuts[index]?.motionDirection,
      transition: clean(item.transition, 500) || fallback.cuts[index]?.transition,
      generationPrompt: clean(item.generationPrompt, 5000) || fallback.cuts[index]?.generationPrompt,
      productLockInstruction: fallback.cuts[index]?.productLockInstruction,
    };
  });
  if (normalizedCuts.some((cut) => !Number.isFinite(cut.startSecond) || !Number.isFinite(cut.endSecond) || cut.startSecond < 0 || cut.endSecond <= cut.startSecond || cut.endSecond > duration) || normalizedCuts.some((cut, index) => index > 0 && cut.startSecond < normalizedCuts[index - 1].endSecond) || normalizedCuts.at(-1)?.endSecond !== duration) {
    return null;
  }
  const concept: VideoConcept = {
    ...fallback,
    title: clean(value.title, 180) || fallback.title,
    coreTarget: clean(value.coreTarget, 180) || fallback.coreTarget,
    openingHook: clean(value.openingHook, 240) || fallback.openingHook,
    fullScript: clean(value.fullScript, 3000) || fallback.fullScript,
    cuts: normalizedCuts,
    requiredSources: compact(Array.isArray(value.requiredSources) ? value.requiredSources : fallback.requiredSources, 10),
    cta: clean(value.cta, 160) || fallback.cta,
    productionCautions: compact(Array.isArray(value.productionCautions) ? value.productionCautions : fallback.productionCautions, 10),
    generationSource: "openai",
    generationWarnings: [],
  };
  return concept;
}

async function generateWithOpenAI(input: { advertiserName: string; analysis: ProductAnalysisSnapshot; guideline: BrandGuideline; duration: VideoDuration; objective: VideoObjective; fallbacks: VideoConcept[]; creativeStyle?: VideoCreativeStyle; productLockedAsset?: ProductLockedAsset; copyGuideContent?: string }) {
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
      input: `${buildVideoPlannerPrompt(facts, input.duration)}\n\n출력 스키마: {"concepts":[{"hookType":"requiredHookTypes 중 값","title":"","coreTarget":"","openingHook":"","fullScript":"","cuts":[{"startSecond":0,"endSecond":3,"sceneDescription":"","caption":"","narration":"","requiredSources":[""]}],"requiredSources":[""],"cta":"","productionCautions":[""]}]}`,
      text: { format: { type: "json_object" } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`OpenAI video script generation failed: HTTP ${response.status}`);
  const parsed = parseJson(responseText(await response.json()));
  const rawConcepts = parsed.concepts || [];
  const allowed = allowedNumbers(input.analysis);
  return input.fallbacks.map((fallback) => {
    const raw = rawConcepts.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).hookType === fallback.hookType);
    const candidate = fromAiConcept(raw, fallback, input.duration);
    if (!candidate) {
      throw new Error(`AI response schema validation failed for ${fallback.hookType}`);
    }
    const forbidden = input.guideline.forbiddenPhrases.filter((phrase) => textFields(candidate).includes(phrase));
    if (forbidden.length || unsupportedNumber(candidate, allowed)) {
      throw new Error(forbidden.length ? `AI response contains forbidden phrase for ${fallback.hookType}` : `AI response contains an unsupported number for ${fallback.hookType}`);
    }
    const validation = validateVideoPlan(candidate, input.analysis, input.duration);
    if (!validation.valid) {
      throw new Error(`AI response quality validation failed for ${fallback.hookType}`);
    }
    candidate.validation = validation;
    return candidate;
  });
}

export async function generateVideoConcepts(input: { advertiserName: string; analysis: ProductAnalysisSnapshot; guideline: BrandGuideline; duration: VideoDuration; objective: VideoObjective; hookTypes?: VideoHookType[]; existingConcepts?: VideoConcept[]; creativeStyle?: VideoCreativeStyle; productLockedAsset?: ProductLockedAsset }) {
  const fallbacks = generateGroundedVideoConcepts(input);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("영상 대본 생성에 필요한 AI 설정을 확인해 주세요.");
  }
  try {
    const copyGuide = await loadCopyGuideForProduct({
      advertiserName: input.advertiserName,
      brandName: input.analysis.brandName,
      productUrl: input.analysis.productUrl,
      category: input.analysis.category,
      productName: input.analysis.productName,
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await generateWithOpenAI({
          ...input,
          fallbacks,
          copyGuideContent: copyGuide?.content,
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } catch (error) {
    throw error instanceof Error ? error : new Error("AI 영상 대본 생성에 실패했습니다.");
  }
}

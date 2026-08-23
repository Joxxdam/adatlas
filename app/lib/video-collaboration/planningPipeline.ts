import crypto from "node:crypto";
import type { ProductAnalysisSnapshot, ProductLockedAsset, ReferenceVideoAnalysis, VideoConcept, VideoConceptScore, VideoCreativeStyle, VideoHookCandidate, VideoHookType, VideoPipelineProgress, VideoPlanValidation, VideoReferenceAsset, VideoVisualBible } from "./types.ts";
import { VIDEO_PLANNING_PIPELINE } from "./prompts.ts";

const genericHookPatterns = [/일상을 바꿔/i, /특별한 경험/i, /새로운 선택/i, /지금 만나/i, /놀라운 변화/i];

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function text(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function first(values: string[] | undefined, fallback = "") {
  return values?.map(text).find(Boolean) || fallback;
}

function evidenceIds(analysis: ProductAnalysisSnapshot, query: string) {
  const key = text(query).replace(/\s/g, "");
  return (analysis.verifiedFacts || [])
    .filter((fact) => {
      const haystack = `${fact.label}${fact.value}`.replace(/\s/g, "");
      return key && (haystack.includes(key) || key.includes(fact.value.replace(/\s/g, "")));
    })
    .map((fact) => fact.id)
    .slice(0, 3);
}

function hookScore(input: { hook: string; visualIdea: string; evidenceCount: number; hasProblem: boolean; policySafe: boolean; typeIndex: number }) {
  const specificity = /\d|원|%|장|개|초|분|kg|ml|g/i.test(input.hook) ? 92 : input.evidenceCount ? 80 : 58;
  const values = {
    stopPower: clamp(82 - input.typeIndex * 2 + (/[?!]|왜|말고|후/i.test(input.hook) ? 8 : 0)),
    specificity,
    productRelevance: clamp(input.evidenceCount ? 92 : 70),
    visualPotential: clamp(input.visualIdea ? 88 : 55),
    evidenceStrength: clamp(input.evidenceCount * 22 + 35),
    conversionPotential: clamp(input.hasProblem ? 88 : 72),
    originality: clamp(genericHookPatterns.some((pattern) => pattern.test(input.hook)) ? 25 : 82),
    policySafety: input.policySafe ? 100 : 20,
  };
  return {
    ...values,
    total: clamp(values.stopPower * 0.17 + values.specificity * 0.13 + values.productRelevance * 0.15 + values.visualPotential * 0.13 + values.evidenceStrength * 0.14 + values.conversionPotential * 0.13 + values.originality * 0.08 + values.policySafety * 0.07),
  };
}

export function buildVideoHookCandidates(analysis: ProductAnalysisSnapshot) {
  const product = text(analysis.productName) || "이 상품";
  const problem = first(analysis.customerProblems, `${product}을 고를 때 놓치기 쉬운 점`);
  const usp = first(analysis.coreUsps, first(analysis.keyFeatures, product));
  const situation = first(analysis.useSituations, first(analysis.targetCustomers, "필요한 순간"));
  const review = first(analysis.repeatedReviewPhrases, first(analysis.trustSignals));
  const benefit = text(analysis.discountInfo) || text(analysis.price);
  const number = first(analysis.verifiedNumbers);
  const rows: Array<[VideoHookType, string, string, string]> = [
    ["problem-solution", `${problem}? 먼저 바꿀 건 따로 있습니다`, problem, `불편한 순간과 해결 후를 같은 동선으로 대비`],
    ["feature-usp", `${usp}, ${product}에서 확인할 한 가지`, problem, `USP 디테일을 매크로 촬영 후 제품 원본으로 매치컷`],
    ["sensory-scene", `${situation}, 화면부터 다르게 느껴지는 이유`, problem, `질감·소리·손동작을 초근접 촬영`],
    ["curiosity", `${number || usp}, 이 숫자부터 보여주는 이유`, problem, `근거를 가린 채 질문 후 다음 컷에서 공개`],
    ["review-trust", review ? `“${review}”라고 말한 이유, 장면으로 확인` : `${product}, 실제 사용 장면에서 먼저 볼 것`, problem, `후기 문장과 실제 사용 동작을 분할 화면으로 연결`],
    ["price-benefit", benefit ? `${benefit}, 가격보다 먼저 확인할 구성` : `${product}, 구매 전에 확인할 조건`, problem, `구성품과 확인된 혜택을 순서대로 펼쳐 보임`],
    ["brand-message", `${product}이 이 장면을 고집한 이유`, problem, `브랜드 세계관에서 제품 정면 라벨로 끝내기`],
  ];
  return rows.map(([hookType, hook, customerProblem, visualIdea], index): VideoHookCandidate => {
    const related = [usp, review, benefit, number, product].filter((value) => value && hook.includes(value));
    const ids = related.flatMap((value) => evidenceIds(analysis, value));
    const policySafe = !(analysis.unsupportedClaims || []).some((claim) => hook.includes(claim.value));
    const score = hookScore({
      hook,
      visualIdea,
      evidenceCount: new Set(ids).size,
      hasProblem: Boolean(first(analysis.customerProblems)),
      policySafe,
      typeIndex: index,
    });
    return {
      id: `hook-${crypto.randomUUID()}`,
      hookType,
      hook,
      customerProblem,
      evidenceIds: [...new Set(ids)],
      visualIdea,
      score,
      rejectionReasons: [...(genericHookPatterns.some((pattern) => pattern.test(hook)) ? ["범용 문구"] : []), ...(!policySafe ? ["확인되지 않은 주장 포함"] : [])],
    };
  });
}

export function selectTopDistinctHooks(candidates: VideoHookCandidate[], count = 3) {
  return [...candidates]
    .filter((candidate) => !candidate.rejectionReasons.length)
    .sort((left, right) => right.score.total - left.score.total)
    .filter((candidate, index, items) => items.findIndex((item) => item.hookType === candidate.hookType) === index)
    .slice(0, count);
}

export function conceptScoreFromHook(hook: VideoHookCandidate): VideoConceptScore {
  const narrativeFlow = clamp((hook.score.productRelevance + hook.score.visualPotential) / 2);
  return { ...hook.score, narrativeFlow, total: clamp(hook.score.total * 0.9 + narrativeFlow * 0.1) };
}

export function buildVisualBible(analysis: ProductAnalysisSnapshot, style: VideoCreativeStyle = "auto"): VideoVisualBible {
  const category = text(analysis.category).toLowerCase();
  const isFood = /식품|농산|축산|육류|고기|과일/.test(category);
  const isBeauty = /뷰티|화장|바디|샤워|생활/.test(category);
  const isFashion = /패션|의류|신발|가방/.test(category);
  return {
    visualMode: style === "auto" ? (isFood ? "appetite-real" : isBeauty ? "sensory-real" : isFashion ? "wearable-editorial" : "ad-real") : style,
    aspectRatio: "9:16",
    mainCharacter: isFood ? "상품을 준비하고 먹는 실제 사용자" : isFashion ? "상품을 착용한 실제 사용자" : "상품을 사용하는 실제 사용자",
    characterAppearance: "과장된 모델 포즈보다 실제 고객처럼 자연스러운 인물",
    wardrobe: "제품 색과 충돌하지 않는 무지 의상, 장면 간 동일 착장",
    backgroundWorld: isFood ? "실제 조리대와 식탁" : isBeauty ? "실제 욕실과 외출 전후 공간" : isFashion ? "일상 동선과 착용 공간" : "실제 사용 맥락",
    colorPalette: isFood ? ["warm red", "cream", "charcoal"] : isBeauty ? ["product accent", "cool white", "deep navy"] : ["product accent", "neutral", "black"],
    lighting: isFood ? "따뜻한 측면광으로 질감과 윤기 강조" : "깨끗한 자연광과 제품 윤곽 림라이트",
    materialTexture: isFood ? "재료의 실제 수분감과 표면 결 유지" : "피부·직물·패키지의 실제 재질 유지",
    cameraStyle: "첫 3초 초근접, 문제 장면 핸드헬드, 제품 공개 정면 안정 숏, CTA 고정 숏",
    productPresentation: "업로드한 상품 원본을 합성하고 라벨·형태·색·비율을 변경하지 않음",
    textSafeArea: "상단 12%, 하단 18%, 좌우 8%를 플랫폼 UI 안전 영역으로 비움",
    transitionRules: ["동작 방향을 이어 붙이는 매치컷", "문제→제품 공개 시 하드컷", "근거→CTA는 제품 중심 푸시인"],
    continuityRules: ["인물·의상·공간·광원 방향 유지", "제품 크기와 라벨 방향의 연속성 유지", "한 장면 한 메시지"],
    negativePrompt: ["제품 라벨 재생성", "가짜 로고", "왜곡된 손", "읽을 수 없는 패키지 글자", "근거 없는 효능 수치", "과도한 텍스트"],
  };
}

export function buildProductLockedAsset(asset?: VideoReferenceAsset): ProductLockedAsset | undefined {
  if (!asset) return undefined;
  return {
    assetId: asset.id,
    filePath: asset.filePath,
    originalFileName: asset.name,
    preserveRules: ["용기 형태와 비율 유지", "뚜껑 형태 유지", "로고·라벨·상품명·표기 수치 유지", "패키지 색상 유지", "원본에 없는 뒷면이나 측면을 생성하지 않음"],
    availableAngles: ["업로드 원본 각도"],
    limitations: ["업로드 원본에 보이지 않는 각도는 합성하지 않습니다."],
  };
}

export function analyzeReferenceAssets(assets: VideoReferenceAsset[]): ReferenceVideoAnalysis[] {
  return assets.map((asset) => {
    const isVideo = asset.mimeType.startsWith("video/");
    return {
      assetId: asset.id,
      assetName: asset.name,
      analysisStatus: isVideo ? "limited" : "not-applicable",
      openingHookMethod: isVideo ? "파일 프레임 분석 전: 수동 확인 필요" : "이미지 레퍼런스",
      openingTiming: "확인 필요",
      cutCount: null,
      averageCutLength: null,
      cameraAndGaze: [],
      actions: [],
      informationDensity: "확인 필요",
      subtitlePosition: "확인 필요",
      transitions: [],
      timingMap: { problem: "확인 필요", product: "확인 필요", usp: "확인 필요", cta: "확인 필요" },
      compositionRatio: { liveAction: null, animation: null, composite: null },
      emotionalTone: "확인 필요",
      reusablePrinciples: [],
      limitations: [isVideo ? "현재 서버는 업로드 영상의 장면·음성을 자동 판독하지 않아 제작 전 검수가 필요합니다." : "정지 이미지는 영상 컷 타이밍 분석 대상이 아닙니다."],
    };
  });
}

export function validateVideoPlan(concept: VideoConcept, analysis: ProductAnalysisSnapshot, duration: number): VideoPlanValidation {
  const cuts = [...concept.cuts].sort((a, b) => a.startSecond - b.startSecond);
  const unsupported = (analysis.unsupportedClaims || []).filter((claim) => JSON.stringify(concept).includes(claim.value));
  const checks = [
    { key: "hook", passed: Boolean(concept.openingHook && cuts[0]?.endSecond <= 3), message: "첫 3초 안에 구체적 후킹이 있습니다." },
    { key: "timeline", passed: cuts[0]?.startSecond === 0 && cuts.at(-1)?.endSecond === duration && cuts.every((cut, i) => i === 0 || cut.startSecond === cuts[i - 1].endSecond), message: "장면 시간이 겹치거나 비지 않고 전체 길이와 일치합니다." },
    { key: "single-message", passed: cuts.every((cut) => cut.caption.length <= 80), message: "장면별 자막이 한 메시지 범위입니다." },
    { key: "production", passed: cuts.every((cut) => cut.cameraComposition && cut.motionDirection && cut.transition && cut.generationPrompt), message: "모든 장면에 촬영·연출·전환·생성 지시가 있습니다." },
    { key: "product-lock", passed: cuts.some((cut) => cut.productLockInstruction?.useOriginalComposite), message: "제품 원본 합성 규칙이 장면에 포함됩니다." },
    { key: "claims", passed: unsupported.length === 0, message: unsupported.length ? "확인되지 않은 주장이 포함됐습니다." : "확인되지 않은 주장을 사용하지 않았습니다." },
    { key: "cta", passed: Boolean(concept.cta && cuts.at(-1)?.caption.includes(concept.cta)), message: "마지막 장면에 CTA가 있습니다." },
  ];
  const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
  return { valid: checks.every((check) => check.passed), score, revised: false, checks };
}

export function pipelineProgress(status: "complete" | "warning" = "complete"): VideoPipelineProgress[] {
  const now = new Date().toISOString();
  return VIDEO_PLANNING_PIPELINE.map((stage) => ({
    stage,
    status: stage === "validation" && status === "warning" ? "warning" : "complete",
    message: stage === "validation" && status === "warning" ? "자동 검증 후 수동 확인 항목이 남았습니다." : "완료",
    updatedAt: now,
  }));
}

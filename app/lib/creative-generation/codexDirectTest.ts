/**
 * 신규 수동·자동 이미지 제작의 단일 기본 계약입니다.
 * 저장된 테스트 작업과의 호환 때문에 영속 문자열은 그대로 유지하지만,
 * 제품 화면에서는 더 이상 테스트/기존 모드를 나누지 않습니다.
 */
export const DEFAULT_CODEX_GENERATION_PIPELINE = "codex-direct-test" as const;
export const DEFAULT_CODEX_GENERATION_WORKFLOW = "codex-direct-test" as const;
export const DEFAULT_CODEX_GENERATION_PROMPT_VERSION = "codex-direct-test-v1";
export const DEFAULT_CODEX_GENERATION_STAGE_ORDER = ["codex-direct-test"] as const;
export const SITE_STORY_SEQUENTIAL_WORKFLOW_VERSION = "site-story-sequential-v1" as const;

/** 저장된 작업과 기존 import를 읽기 위한 호환 별칭입니다. */
export const CODEX_DIRECT_TEST_PIPELINE = DEFAULT_CODEX_GENERATION_PIPELINE;
export const CODEX_DIRECT_TEST_WORKFLOW = DEFAULT_CODEX_GENERATION_WORKFLOW;
export const CODEX_DIRECT_TEST_PROMPT_VERSION = DEFAULT_CODEX_GENERATION_PROMPT_VERSION;
export const CODEX_DIRECT_TEST_STAGE_ORDER = DEFAULT_CODEX_GENERATION_STAGE_ORDER;

export const SERVICE_ANALYSIS_CODEX_GENERATION_PROMPT = `해당 레퍼런스를 참고해서 서비스분석내용을 바탕으로 분석한 서비스에 맞는 콘텐츠를 ImageGen기능을 활용하여 1200*1200 사이즈로 제작해줘.


*참고사항
1.마스코트/로고/기능이미지는 전달시에 크롭해서 활용할수도있고, 안해도돼.
2.전체적인 색감/캐릭터(카툰/동물/3d/손그림)/인물/배경은 분석한 서비스에 어울리게 구현해줘.

*주의사항
1.문구뉘앙스는 유지해도 좋지만,그대로 쓰면 안되고 변형해줘.`;

export const SERVICE_STORY_CODEX_GENERATION_PROMPT = `해당 레퍼런스를 참고해서 서비스분석내용을 바탕으로 분석한 서비스에 맞는 콘텐츠를 ImageGen기능을 활용하여 1200*1200 사이즈로 제작해줘.

6장에 해당 서비스의 스토리가 잘녹아들면서 순서대로 이해가 쉽도록 기획후 제작해줘.

*참고사항
1.마스코트/로고/기능이미지는 전달시에 크롭해서 활용할수도있고, 안해도돼.
2.전체적인 색감/캐릭터(카툰/동물/3d/손그림)/인물/배경은 분석한 서비스에 어울리게 구현해줘.
*주의사항
1.문구뉘앙스는 유지해도 좋지만,그대로 쓰면 안되고 변형해줘.`;

export function buildServiceAnalysisCodexGenerationPrompt() {
  return SERVICE_ANALYSIS_CODEX_GENERATION_PROMPT;
}

export function buildServiceStoryCodexGenerationPrompt() {
  return SERVICE_STORY_CODEX_GENERATION_PROMPT;
}

export function buildDefaultCodexDirectTestPrompt(input: {
  landingUrl: string;
  hasSupportingImage: boolean;
  hasPackagingImage?: boolean;
}) {
  const attachmentDescription = input.hasSupportingImage && input.hasPackagingImage
    ? "(첫번째 첨부사진이 레퍼런스,두번째사진이 비슷하게 생성원하는이미지, 3번째사진이 라벨이미지로 참고/라벨이 없다면 분위기 참고이미지, 4번째사진이 포장상품이미지)"
    : input.hasSupportingImage
      ? "(첫번째 첨부사진이 레퍼런스,두번째사진이 비슷하게 생성원하는이미지, 3번째사진이 라벨이미지로 참고/라벨이 없다면 분위기 참고이미지)"
      : input.hasPackagingImage
        ? "(첫번째 첨부사진이 레퍼런스,두번째사진이 비슷하게 생성원하는이미지, 추가 첨부사진이 포장상품이미지)"
        : "(첫번째 첨부사진이 레퍼런스, 두번째사진이 비슷하게 생성원하는이미지)";
  return `해당 레퍼런스 구도랑 문구뉘앙스는 그대로 유지하면서,
${attachmentDescription}
*참고로 화장품의 경우 2번째사진의 원본을 최대한 반영해야함. 새롭게 원본을 훼손해서 생성하는 일 없도록 꼼꼼히 검토할것
${input.landingUrl}
해당상품으로 상품만 교체해줘. 문구는 뉘앙스는 유지하되,
지금 계절성시즌/상품특성/사회적특성/어떤상황에대한가정은 상세페이지 활용해서 그대로만 쓰지말고 뉘앙스 참고해서 맘대로 바꿔.
상세페이지에있는 이미지안에도 참고할수있는 문구들이 있다면 이미지도 읽어서 반영해도돼.
이미지는 첨부이미지 참고해서 광고콘텐츠용으로 1200*1200 사이즈로 생성해서 전달줘.
만약 조리사진이 있거나 인물사진이 있다면 너가 알아서 상품에 어울리게 새롭게 해당부분은 변경하면돼.
인물의 경우 캐릭터가 더 어울린다고 생각하면 캐릭터로 변형해서 생성하는것도가능함(카툰/실사/손그림/3d캐릭터/상품의마스코트캐릭터 등등)
식품의경우 조리사진은 최대한 자연스럽게부탁할게.
*참고사항 1 : 레퍼런스에 원본상품+포장상품도 같이 포함되어있을경우 4번이미지(포장상품이미지)를 같이 활용하면된다.
*참고사항 2 : 전체적인 색감은 상품에 맞게 변형가능함.

*주의사항 1 : 한우랑 설록우는 다름. 한우라는 단어는 상품이 한우일때만 콘텐츠에 표기가능함.
설록우는 특별히 강조할 문구나 특징이아니다. 굳이 표기할 필요없다.
오히려 상품이름앞에는 상품의 특징정보가 있으면 좋다! 찰진~등심/고소한등심/존맛등심 등등
*주의사항 2 : 레퍼런스에 인물/캐릭터가 있을 경우 상품에 맞게 변형해야 된다.`;
}

export const buildDefaultCodexGenerationPrompt = buildDefaultCodexDirectTestPrompt;

export function normalizeCodexDirectTestPrompt(value: unknown) {
  return String(value || "").normalize("NFKC").trim().slice(0, 6_000);
}

export const normalizeDefaultCodexGenerationPrompt = normalizeCodexDirectTestPrompt;

export function normalizeCodexGenerationAdditionalInstructions(value: unknown) {
  return String(value || "").normalize("NFKC").trim().slice(0, 6_000);
}

export function appendCodexGenerationAdditionalInstructions(basePrompt: string, value: unknown) {
  const prompt = normalizeDefaultCodexGenerationPrompt(basePrompt);
  const additionalInstructions = normalizeCodexGenerationAdditionalInstructions(value);
  return additionalInstructions
    ? `${prompt}\n\n[추가/강조 사항]\n${additionalInstructions}`
    : prompt;
}

export function buildCodexDirectTestExecutionNote(input: {
  landingUrl: string;
  outputPath: string;
  hasSupportingImage: boolean;
  hasPackagingImage?: boolean;
  analysisMode?: "product" | "site";
  siteVisualCount?: number;
}) {
  const siteAnalysisMode = input.analysisMode === "site";
  const siteVisualCount = Math.max(0, Math.min(5, Math.floor(input.siteVisualCount || 0)));
  const attachmentOrder = siteAnalysisMode
    ? `1) 광고 레퍼런스${siteVisualCount ? ` 2~${siteVisualCount + 1}) 사이트에서 선택한 로고·마스코트·기능 이미지` : ""}`
    : [
        "1) 광고 레퍼런스",
        "2) 선택 상품 이미지",
        input.hasSupportingImage ? "3) 라벨 또는 추가 참고 이미지" : "",
        input.hasPackagingImage
          ? `${input.hasSupportingImage ? "4" : "3"}) 포장상품 이미지${input.hasSupportingImage ? "" : " (프롬프트의 선택 4번 역할)"}`
          : "",
      ].filter(Boolean).join(" ");
  return [
    "[AdAtlas 실행 정보 — 창작 지시를 추가하거나 바꾸지 마세요]",
    `첨부 순서: ${attachmentOrder}`,
    `${siteAnalysisMode ? "분석 사이트" : "선택 상품"} URL: ${input.landingUrl}`,
    "imagegen 스킬로 결과 이미지 한 장을 생성하세요.",
    `최종 결과를 정확히 다음 경로에 저장하세요: ${input.outputPath}`,
  ].join("\n");
}

function compactServiceAnalysisValue(value: unknown, max = 600) {
  const normalized = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function compactServiceAnalysisList(values: unknown, maxItems = 8) {
  return Array.isArray(values)
    ? values.map((value) => compactServiceAnalysisValue(value, 240)).filter(Boolean).slice(0, maxItems).join(" · ")
    : "";
}

/** 사용자가 작성한 서비스 프롬프트를 바꾸지 않고 별도 근거 블록으로 전달합니다. */
export function buildServiceAnalysisCodexContext(input: {
  siteName?: string;
  oneLineSummary?: string;
  businessModel?: string;
  offerings?: string[];
  coreValueProps?: string[];
  customerProblems?: string[];
  differentiators?: string[];
  trustSignals?: string[];
  conversionOffers?: string[];
  targetPriorities?: Array<{ rank?: number; name?: string; reason?: string }>;
  adDirections?: Array<{ target?: string; angle?: string; sampleMessage?: string }>;
  cautions?: string[];
  selectedVisuals?: Array<{ role?: string; label?: string }>;
}) {
  const targets = (input.targetPriorities || []).slice(0, 6).map((target) =>
    compactServiceAnalysisValue([target.rank ? `${target.rank}순위` : "", target.name, target.reason].filter(Boolean).join(" · "), 360)
  ).filter(Boolean).join(" / ");
  const directions = (input.adDirections || []).slice(0, 6).map((direction) =>
    compactServiceAnalysisValue([direction.target, direction.angle, direction.sampleMessage].filter(Boolean).join(" · "), 420)
  ).filter(Boolean).join(" / ");
  const visuals = (input.selectedVisuals || []).slice(0, 5).map((visual) =>
    compactServiceAnalysisValue(`${visual.role || "시각 자료"}: ${visual.label || "선택 이미지"}`, 180)
  ).filter(Boolean).join(" · ");
  return [
    "[AdAtlas 서비스 분석 정보]",
    input.siteName ? `서비스명: ${compactServiceAnalysisValue(input.siteName, 240)}` : "",
    input.oneLineSummary ? `서비스 요약: ${compactServiceAnalysisValue(input.oneLineSummary)}` : "",
    input.businessModel ? `서비스 구조: ${compactServiceAnalysisValue(input.businessModel)}` : "",
    compactServiceAnalysisList(input.offerings) ? `제공 서비스: ${compactServiceAnalysisList(input.offerings)}` : "",
    compactServiceAnalysisList(input.coreValueProps) ? `핵심 가치: ${compactServiceAnalysisList(input.coreValueProps)}` : "",
    compactServiceAnalysisList(input.customerProblems) ? `고객 문제: ${compactServiceAnalysisList(input.customerProblems)}` : "",
    compactServiceAnalysisList(input.differentiators) ? `차별점: ${compactServiceAnalysisList(input.differentiators)}` : "",
    compactServiceAnalysisList(input.trustSignals) ? `신뢰 근거: ${compactServiceAnalysisList(input.trustSignals)}` : "",
    compactServiceAnalysisList(input.conversionOffers) ? `전환 요소: ${compactServiceAnalysisList(input.conversionOffers)}` : "",
    targets ? `우선 타겟: ${targets}` : "",
    directions ? `분석된 광고 방향: ${directions}` : "",
    compactServiceAnalysisList(input.cautions) ? `확인 사항: ${compactServiceAnalysisList(input.cautions)}` : "",
    visuals ? `선택한 시각 자료: ${visuals}` : "",
  ].filter(Boolean).join("\n");
}

/** 공통 기획은 별도 근거 블록으로 붙여 사용자가 확정한 스토리 프롬프트를 바꾸지 않습니다. */
export function buildServiceStoryCodexContext(input: {
  title?: string;
  narrativeArc?: string;
  visualContinuity?: string;
  slides: Array<{
    order: number;
    purpose: string;
    keyMessage: string;
    visualDirection: string;
    transition: string;
  }>;
  currentSlideOrder: number;
}) {
  const current = input.slides.find((slide) => slide.order === input.currentSlideOrder);
  if (!current) return "";
  const fullSequence = input.slides
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((slide) => `${slide.order}장: ${compactServiceAnalysisValue(slide.purpose, 160)} · ${compactServiceAnalysisValue(slide.keyMessage, 220)}`)
    .join("\n");
  return [
    "[AdAtlas 6장 스토리 공통 기획 — 순서를 바꾸지 마세요]",
    input.title ? `스토리 제목: ${compactServiceAnalysisValue(input.title, 220)}` : "",
    input.narrativeArc ? `전체 흐름: ${compactServiceAnalysisValue(input.narrativeArc, 600)}` : "",
    input.visualContinuity ? `6장 공통 시각 연결: ${compactServiceAnalysisValue(input.visualContinuity, 600)}` : "",
    "전체 6장 순서:",
    fullSequence,
    `지금 생성할 장: ${current.order}/6`,
    `이번 장의 역할: ${compactServiceAnalysisValue(current.purpose, 300)}`,
    `이번 장의 핵심 메시지: ${compactServiceAnalysisValue(current.keyMessage, 420)}`,
    `이번 장의 화면 방향: ${compactServiceAnalysisValue(current.visualDirection, 500)}`,
    `다음 장과의 연결: ${compactServiceAnalysisValue(current.transition, 300)}`,
    "이번 호출에서는 위 순서 중 지금 생성할 장 한 장만 완성하세요.",
  ].filter(Boolean).join("\n");
}

export const buildDefaultCodexGenerationExecutionNote = buildCodexDirectTestExecutionNote;

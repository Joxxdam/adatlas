/**
 * 신규 수동·자동 이미지 제작의 단일 기본 계약입니다.
 * 저장된 테스트 작업과의 호환 때문에 영속 문자열은 그대로 유지하지만,
 * 제품 화면에서는 더 이상 테스트/기존 모드를 나누지 않습니다.
 */
export const DEFAULT_CODEX_GENERATION_PIPELINE = "codex-direct-test" as const;
export const DEFAULT_CODEX_GENERATION_WORKFLOW = "codex-direct-test" as const;
export const DEFAULT_CODEX_GENERATION_PROMPT_VERSION = "codex-direct-test-v1";
export const DEFAULT_CODEX_GENERATION_STAGE_ORDER = ["codex-direct-test"] as const;

/** 저장된 작업과 기존 import를 읽기 위한 호환 별칭입니다. */
export const CODEX_DIRECT_TEST_PIPELINE = DEFAULT_CODEX_GENERATION_PIPELINE;
export const CODEX_DIRECT_TEST_WORKFLOW = DEFAULT_CODEX_GENERATION_WORKFLOW;
export const CODEX_DIRECT_TEST_PROMPT_VERSION = DEFAULT_CODEX_GENERATION_PROMPT_VERSION;
export const CODEX_DIRECT_TEST_STAGE_ORDER = DEFAULT_CODEX_GENERATION_STAGE_ORDER;

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
*참고사항 : 레퍼런스에 원본상품+포장상품도 같이 포함되어있을경우 4번이미지(포장상품이미지)를 같이 활용하면된다.
*주의사항 : 한우랑 설록우는 다름. 한우라는 단어는 상품이 한우일때만 콘텐츠에 표기가능함.
설록우는 특별히 강조할 문구나 특징이 오히려 아니다(상품이름정도로는 활용가능)오히려 상품이름앞에는 상품의 특징정도가 있으면 좋다! 찰진~등심/고소한등심/존맛등심 등등`;
}

export const buildDefaultCodexGenerationPrompt = buildDefaultCodexDirectTestPrompt;

export function normalizeCodexDirectTestPrompt(value: unknown) {
  return String(value || "").normalize("NFKC").trim().slice(0, 6_000);
}

export const normalizeDefaultCodexGenerationPrompt = normalizeCodexDirectTestPrompt;

export function normalizeCodexGenerationAdditionalInstructions(value: unknown) {
  return String(value || "").normalize("NFKC").trim().slice(0, 2_000);
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
}) {
  const attachmentOrder = [
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
    `선택 상품 URL: ${input.landingUrl}`,
    "imagegen 스킬로 결과 이미지 한 장을 생성하세요.",
    `최종 결과를 정확히 다음 경로에 저장하세요: ${input.outputPath}`,
  ].join("\n");
}

export const buildDefaultCodexGenerationExecutionNote = buildCodexDirectTestExecutionNote;

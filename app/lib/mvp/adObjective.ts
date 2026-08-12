import type { AdBrief, AdHookType, AdObjective, CreativeIntensity } from "./types";

export type AdObjectiveProfile = {
  label: string;
  audienceState: string;
  primaryTask: string;
  messageSequence: string;
  headlineRule: string;
  bodyRule: string;
  ctaRule: string;
  avoidRule: string;
  preferredHookTypes: AdHookType[];
};

const profiles: Record<AdObjective, AdObjectiveProfile> = {
  purchase: {
    label: "구매 전환",
    audienceState: "상품을 비교하며 구매 결정을 앞둔 고객",
    primaryTask: "확인된 혜택과 상품 차이를 구매할 이유로 전환",
    messageSequence: "구매 이유 → 상세페이지 근거 → 확인된 조건 → 행동 유도",
    headlineRule: "USP나 확인된 구매 조건을 지금 선택할 이유로 연결한다.",
    bodyRule: "가격·품질·구성에 대한 망설임을 다른 확인된 근거로 줄인다.",
    ctaRule: "구매 조건이나 구성 확인처럼 결정에 가까운 행동을 요청한다.",
    avoidRule: "브랜드 분위기만 말하거나 확인되지 않은 긴급성으로 압박하지 않는다.",
    preferredHookTypes: ["price-benefit", "problem-solution", "feature-usp"],
  },
  signup: {
    label: "신규 고객 확보",
    audienceState: "상품과 브랜드를 처음 접해 필요성과 차이를 아직 모르는 고객",
    primaryTask: "익숙한 문제나 사용 장면에서 시작해 상품의 첫 선택 기준을 설명",
    messageSequence: "고객 문제·상황 → 상품 필요성 → 구체적인 차이 → 부담 낮은 탐색",
    headlineRule: "사전 지식을 전제하지 말고 왜 필요한지 또는 무엇이 다른지 한눈에 설명한다.",
    bodyRule: "낯선 기능명만 나열하지 말고 고객이 얻는 변화와 확인된 근거를 연결한다.",
    ctaRule: "차이점 알아보기나 상품 정보 보기처럼 탐색 장벽이 낮은 행동을 요청한다.",
    avoidRule: "이미 상품을 봤다고 가정하거나 가격과 구매 압박부터 앞세우지 않는다.",
    preferredHookTypes: ["problem-solution", "feature-usp", "curiosity"],
  },
  awareness: {
    label: "브랜드 인지도",
    audienceState: "브랜드를 아직 잘 모르고 대표 이미지를 형성하지 않은 고객",
    primaryTask: "브랜드명과 대표 USP 또는 감각을 하나의 기억점으로 고정",
    messageSequence: "브랜드명 → 대표 차이·감각 → 짧은 연상 장면 → 브랜드 탐색",
    headlineRule: "브랜드명과 대표 메시지가 함께 기억되게 하며 가격을 주인공으로 두지 않는다.",
    bodyRule: "여러 혜택을 나열하지 말고 브랜드를 대표할 한 가지 차이나 감각을 선명하게 남긴다.",
    ctaRule: "브랜드 알아보기나 브랜드 이야기 보기처럼 기억을 확장하는 행동을 요청한다.",
    avoidRule: "할인 정보만 크게 외치거나 즉시 구매 압박으로 브랜드 기억을 흐리지 않는다.",
    preferredHookTypes: ["brand-story", "sensory", "lifestyle"],
  },
  retargeting: {
    label: "재구매·리타겟팅",
    audienceState: "상품을 이미 봤지만 비교·망설임 때문에 결정하지 않은 고객",
    primaryTask: "처음 설명을 반복하지 않고 망설임을 깨는 근거와 확인된 혜택을 재환기",
    messageSequence: "망설임 환기 → 놓쳤던 구매 근거 → 확인된 혜택 → 다시 확인",
    headlineRule: "다시 볼 이유나 망설임을 끝낼 구체적인 상품 근거를 제시한다.",
    bodyRule: "상품 소개를 처음부터 반복하지 말고 구매 장벽에 답하는 다른 근거를 덧붙인다.",
    ctaRule: "혜택 다시 보기나 선택 이유 다시 보기처럼 재검토 행동을 요청한다.",
    avoidRule: "확인되지 않은 품절·마감·재고 표현으로 조급함을 만들지 않는다.",
    preferredHookTypes: ["price-benefit", "social-proof", "problem-solution"],
  },
};

export type CreativeApproachProfile = {
  label: string;
  description: string;
  copyDirection: string;
  visualDirection: string;
  ctaDirection: string;
};

const approachProfiles: Record<CreativeIntensity, CreativeApproachProfile> = {
  brand: {
    label: "브랜드·공감 중심",
    description: "사용 장면과 감각을 먼저 보여주고 자연스럽게 상품을 기억시킵니다.",
    copyDirection: "공감과 브랜드 인상을 먼저 전달하는 부드러운 문구",
    visualDirection: "라이프스타일·감각 장면 중심, 가격 노출은 보조",
    ctaDirection: "부담이 낮은 탐색형 행동 유도",
  },
  balanced: {
    label: "균형형 가설 테스트",
    description: "문제·USP·후기·혜택을 서로 다른 6개 가설로 고르게 테스트합니다.",
    copyDirection: "상품 장점과 고객 상황을 균형 있게 설명하는 문구",
    visualDirection: "상품과 사용 장면, 근거의 균형",
    ctaDirection: "목표에 맞는 명확한 행동 유도",
  },
  performance: {
    label: "전환 집중형",
    description: "확인된 가격·구성·근거와 CTA를 앞세워 빠른 행동을 유도합니다.",
    copyDirection: "구매 이유와 확인된 혜택을 앞세운 직접적인 문구",
    visualDirection: "상품·혜택·CTA 위계 강화",
    ctaDirection: "결정에 가까운 직접 행동 유도",
  },
};

const objectiveHookTypes: Record<AdObjective, string[]> = {
  purchase: ["price-benefit", "feature-usp", "problem-solution", "social-proof", "comparison", "proof-data"],
  signup: ["problem-solution", "feature-usp", "curiosity", "lifestyle", "social-proof", "product-hero"],
  awareness: ["brand-story", "sensory", "lifestyle", "product-hero", "editorial-story", "empathy-situation"],
  retargeting: ["price-benefit", "social-proof", "problem-solution", "comparison", "feature-usp", "proof-data"],
};

export function getAdObjectiveProfile(objective: AdObjective | undefined) {
  return profiles[objective || "purchase"];
}

export function getCreativeApproachProfile(intensity: CreativeIntensity | undefined) {
  return approachProfiles[intensity || "balanced"];
}

export function getGenerationHookTypes(brief: Pick<AdBrief, "adObjective" | "creativeIntensity">) {
  const base = objectiveHookTypes[brief.adObjective];
  if (brief.creativeIntensity === "brand") {
    return [...base.slice(2), ...base.slice(0, 2)];
  }
  if (brief.creativeIntensity === "performance") {
    const direct = ["price-benefit", "problem-solution", "proof-data", "feature-usp", "comparison", "social-proof"];
    return [...direct.filter((hook) => base.includes(hook)), ...base.filter((hook) => !direct.includes(hook))];
  }
  return base;
}

export function getGenerationPlanSummary(brief: Pick<AdBrief, "adObjective" | "creativeIntensity">) {
  const objective = getAdObjectiveProfile(brief.adObjective);
  const approach = getCreativeApproachProfile(brief.creativeIntensity);
  return {
    objectiveLabel: objective.label,
    approachLabel: approach.label,
    audience: objective.audienceState,
    copy: approach.copyDirection,
    visual: approach.visualDirection,
    cta: `${objective.ctaRule} ${approach.ctaDirection}`,
  };
}

export function adObjectivePrompt(objective: AdObjective | undefined) {
  const profile = getAdObjectiveProfile(objective);
  return [
    `${profile.label} — ${profile.primaryTask}`,
    `고객 상태: ${profile.audienceState}`,
    `메시지 순서: ${profile.messageSequence}`,
    `headline: ${profile.headlineRule}`,
    `bodyCopy: ${profile.bodyRule}`,
    `CTA: ${profile.ctaRule}`,
    `금지: ${profile.avoidRule}`,
  ].join("\n");
}

export function objectiveCta(objective: AdObjective | undefined, hasConfirmedOffer: boolean) {
  if (objective === "signup") return "차이점 알아보기";
  if (objective === "awareness") return "브랜드 알아보기";
  if (objective === "retargeting") {
    return hasConfirmedOffer ? "혜택 다시 보기" : "선택 이유 다시 보기";
  }
  return hasConfirmedOffer ? "구매 조건 보기" : "구매 이유 보기";
}

export function isObjectiveCtaAligned(value: string, objective: AdObjective | undefined) {
  if (!value.trim()) return false;
  if (objective === "signup") return /(알아|차이|정보|상품|살펴)/.test(value);
  if (objective === "awareness") return /(브랜드|이야기|알아|기억|살펴)/.test(value);
  if (objective === "retargeting") return /(다시|혜택|조건|선택|구성)/.test(value);
  return /(구매|조건|혜택|구성|선택|상품|주문)/.test(value);
}

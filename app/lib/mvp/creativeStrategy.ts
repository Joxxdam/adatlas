import type { AdBrief, AdImageLabel, CreativeStrategy, ReferenceUsageSelection } from "./types";

type StrategySeed = {
  key: string;
  title: string;
  hook: string;
  appeal: string;
  visual: string;
  risk: string;
};

const seeds: StrategySeed[] = [
  {
    key: "value-proof",
    title: "가격을 납득시키는 구성 증명",
    hook: "가격 숫자보다 구성과 효용을 먼저 보여 준 뒤 구매 명분을 만듭니다.",
    appeal: "가격 대비 구성, 실사용 가치, 지금 사도 되는 이유",
    visual: "상품 면적을 크게 쓰고 가격과 핵심 구성은 하나의 정보 블록으로 묶습니다.",
    risk: "확인되지 않은 할인율이나 수량은 사용하지 않습니다.",
  },
  {
    key: "problem-solution",
    title: "고객의 불편을 먼저 찌르는 해결형",
    hook: "고객이 반복해서 겪는 불편을 첫 문장에 두고 상품을 즉시 해결책으로 연결합니다.",
    appeal: "불편 해소, 시간 절약, 구매 장벽 제거",
    visual: "문제 문장은 짧게, 상품과 해결 근거는 대비가 강한 영역에 배치합니다.",
    risk: "고객의 불안을 과장하거나 공포를 조장하지 않습니다.",
  },
  {
    key: "social-proof",
    title: "실사용 반응처럼 읽히는 후기형",
    hook: "광고 문장보다 사용자가 발견한 장점처럼 자연스럽게 시작합니다.",
    appeal: "후기 신뢰, 구체적인 사용 장면, 재구매 명분",
    visual: "실사용 이미지와 짧은 반응형 문구를 중심으로 정보량을 줄입니다.",
    risk: "실제 근거가 없는 평점, 판매량, 후기 수는 만들지 않습니다.",
  },
  {
    key: "curiosity",
    title: "첫 문장에서 멈추게 하는 궁금증형",
    hook: "레퍼런스의 문장 리듬과 끊김을 활용해 다음 내용을 확인하게 만듭니다.",
    appeal: "반전, 발견의 재미, 신상품 또는 새로운 사용 맥락",
    visual: "초대형 헤드라인과 단일 상품 비주얼로 시선을 빠르게 모읍니다.",
    risk: "레퍼런스 문구를 그대로 복제하거나 억지 밈을 붙이지 않습니다.",
  },
  {
    key: "benefit-first",
    title: "핵심 효용을 한눈에 보여 주는 혜택형",
    hook: "고객이 얻게 되는 결과를 가장 먼저 명확하게 말합니다.",
    appeal: "주요 효용, 차별점, 선택 기준 단순화",
    visual: "효용 문구와 상품을 가까이 배치하고 보조 설명은 한 문장으로 제한합니다.",
    risk: "효능을 단정하거나 제품 정보에 없는 결과를 약속하지 않습니다.",
  },
  {
    key: "occasion",
    title: "상황과 명분을 만드는 사용 장면형",
    hook: "선물, 모임, 출근, 주말처럼 필요한 순간을 먼저 제시합니다.",
    appeal: "사용 상황, 선물 명분, 결정 피로 감소",
    visual: "사용 장면이 드러나는 배경과 상품을 함께 보여 주되 카피는 차분하게 유지합니다.",
    risk: "카테고리와 맞지 않는 상황을 억지로 연결하지 않습니다.",
  },
];

function referenceText(labels: AdImageLabel[]) {
  return labels
    .flatMap((label) => {
      const final = label.finalLabel;
      return [
        final?.hookType,
        final?.appealPoint,
        final?.copyNuance,
        final?.consumerInsight,
        final?.purchaseTrigger,
        final?.whyItWorks,
      ];
    })
    .filter(Boolean)
    .join(" ");
}

function scoreSeed(seed: StrategySeed, brief: AdBrief, labels: AdImageLabel[]) {
  const pool = `${brief.desiredHookType} ${brief.offerType} ${brief.customerProblem} ${brief.mainBenefit} ${referenceText(labels)}`;
  let score = 0;
  if (seed.key === "value-proof" && /가격|할인|구성|가성비|특가|선물/.test(pool)) score += 5;
  if (seed.key === "problem-solution" && /문제|불편|고민|장벽|귀찮|해결/.test(pool)) score += 5;
  if (seed.key === "social-proof" && /후기|리뷰|반응|평점|재구매/.test(pool)) score += 5;
  if (seed.key === "curiosity" && /UGC|밈|반전|궁금|끊|유행|SNS/.test(pool)) score += 5;
  if (seed.key === "benefit-first" && brief.mainBenefit) score += 3;
  if (seed.key === "occasion" && /선물|모임|상황|부모님|집들이|출근|주말/.test(pool)) score += 4;
  if (
    brief.creativeIntensity === "performance" &&
    ["value-proof", "problem-solution", "curiosity"].includes(seed.key)
  )
    score += 2;
  if (brief.creativeIntensity === "brand" && ["benefit-first", "occasion"].includes(seed.key))
    score += 2;
  return score;
}

export function buildCreativeStrategies(params: {
  brief: AdBrief;
  references: AdImageLabel[];
  usages: ReferenceUsageSelection[];
  batch?: number;
}): CreativeStrategy[] {
  const batch = params.batch || 0;
  const scored = [...seeds].sort(
    (a, b) =>
      scoreSeed(b, params.brief, params.references) - scoreSeed(a, params.brief, params.references)
  );
  const offset = (batch * 3) % scored.length;
  const ordered = [...scored.slice(offset), ...scored.slice(0, offset)];
  const unique = ordered.slice(0, 3);
  const referenceNames = params.references
    .map((label) => label.brandName || label.finalLabel?.hookType || label.imageId)
    .filter(Boolean)
    .join(", ");
  const usedAspects = Array.from(new Set(params.usages.flatMap((usage) => usage.aspects))).join(
    ", "
  );

  return unique.map((seed, index) => ({
    id: `${seed.key}-${batch}-${index}`,
    title: seed.title,
    explanation: `${params.brief.targetCustomer || "핵심 고객"}이 구매 결정을 빠르게 내리도록 ${seed.appeal}을 중심으로 설계합니다.`,
    mainHookAngle: seed.hook,
    coreAppealPoint: params.brief.mainBenefit || seed.appeal,
    audienceFit: `${params.brief.awarenessStage} 단계의 ${params.brief.targetCustomer || "잠재 고객"}`,
    referenceFit: referenceNames
      ? `${referenceNames}의 ${usedAspects || "후킹 구조"}만 참고하고 원문은 복제하지 않습니다.`
      : "선택된 레퍼런스가 없어 광고 브리프의 사실 정보만 사용합니다.",
    suggestedVisualEmphasis: seed.visual,
    risk: seed.risk,
  }));
}

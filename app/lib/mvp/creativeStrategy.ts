import type { AdBrief, AdHookType, AdImageLabel, AdProductPosition, AdTextSafeArea, CreativeStrategy, ProductInfoForPrompt, ReferenceUsageSelection } from "./types";
import { inferAdBriefContext } from "./adBriefInference";
import { getAdObjectiveProfile } from "./adObjective";
import { analyzeProductUsp, buildTargetedStrategyContent } from "./productUsp";

type StrategySeed = {
  key: string;
  title: string;
  hookType: AdHookType;
  hook: string;
  appeal: string;
  visual: string;
  scene: string;
  mood: string[];
  textSafeArea: AdTextSafeArea;
  productPosition: AdProductPosition;
  backgroundTags: string[];
  risk: string;
};

const seeds: StrategySeed[] = [
  {
    key: "value-proof",
    title: "구매혜택 한눈에",
    hookType: "price-benefit",
    hook: "가격 숫자보다 구성과 효용을 먼저 보여 준 뒤 구매 명분을 만듭니다.",
    appeal: "가격 대비 구성, 실사용 가치, 지금 사도 되는 이유",
    visual: "상품 면적을 크게 쓰고 가격과 핵심 구성은 하나의 정보 블록으로 묶습니다.",
    scene: "상품이 선명하게 돋보이는 정돈된 커머스 스튜디오",
    mood: ["명확한", "신뢰감", "전환형"],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: ["커머스", "단색", "가격강조", "여백"],
    risk: "확인되지 않은 할인율이나 수량은 사용하지 않습니다.",
  },
  {
    key: "problem-solution",
    title: "고민 해결 포인트",
    hookType: "problem-solution",
    hook: "고객이 반복해서 겪는 불편을 첫 문장에 두고 상품을 즉시 해결책으로 연결합니다.",
    appeal: "불편 해소, 시간 절약, 구매 장벽 제거",
    visual: "문제 문장은 짧게, 상품과 해결 근거는 대비가 강한 영역에 배치합니다.",
    scene: "고객의 불편과 해결 이후를 자연스럽게 떠올릴 수 있는 생활 공간",
    mood: ["공감", "현실적", "편안한"],
    textSafeArea: "top-left",
    productPosition: "bottom-right",
    backgroundTags: ["라이프스타일", "문제해결", "자연광", "생활공간"],
    risk: "고객의 불안을 과장하거나 공포를 조장하지 않습니다.",
  },
  {
    key: "social-proof",
    title: "신뢰 근거 강조",
    hookType: "social-proof",
    hook: "광고 문장보다 사용자가 발견한 장점처럼 자연스럽게 시작합니다.",
    appeal: "후기 신뢰, 구체적인 사용 장면, 재구매 명분",
    visual: "실사용 이미지와 짧은 반응형 문구를 중심으로 정보량을 줄입니다.",
    scene: "실사용 후기의 진정성이 느껴지는 자연광 테이블 장면",
    mood: ["진정성", "따뜻한", "일상적"],
    textSafeArea: "top-right",
    productPosition: "bottom-left",
    backgroundTags: ["후기", "실사용", "자연광", "테이블"],
    risk: "실제 근거가 없는 평점, 판매량, 후기 수는 만들지 않습니다.",
  },
  {
    key: "curiosity",
    title: "차이점 궁금증",
    hookType: "curiosity",
    hook: "레퍼런스의 문장 리듬과 끊김을 활용해 다음 내용을 확인하게 만듭니다.",
    appeal: "반전, 발견의 재미, 신상품 또는 새로운 사용 맥락",
    visual: "초대형 헤드라인과 단일 상품 비주얼로 시선을 빠르게 모읍니다.",
    scene: "강한 색면과 그림자로 차이점을 궁금하게 만드는 에디토리얼 세트",
    mood: ["대담한", "발견", "현대적"],
    textSafeArea: "center-left",
    productPosition: "center-right",
    backgroundTags: ["에디토리얼", "컬러블록", "강한대비", "그래픽"],
    risk: "레퍼런스 문구를 그대로 복제하거나 억지 밈을 붙이지 않습니다.",
  },
  {
    key: "benefit-first",
    title: "USP 한눈에",
    hookType: "feature-usp",
    hook: "고객이 얻게 되는 결과를 가장 먼저 명확하게 말합니다.",
    appeal: "주요 효용, 차별점, 선택 기준 단순화",
    visual: "효용 문구와 상품을 가까이 배치하고 보조 설명은 한 문장으로 제한합니다.",
    scene: "제품의 소재와 품질을 세밀하게 보여 주는 깨끗한 프리미엄 세트",
    mood: ["정제된", "프리미엄", "선명한"],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: ["프리미엄", "소재", "클린", "스튜디오"],
    risk: "효능을 단정하거나 제품 정보에 없는 결과를 약속하지 않습니다.",
  },
  {
    key: "occasion",
    title: "사용 순간 제안",
    hookType: "lifestyle",
    hook: "선물, 모임, 출근, 주말처럼 필요한 순간을 먼저 제시합니다.",
    appeal: "사용 상황, 선물 명분, 결정 피로 감소",
    visual: "사용 장면이 드러나는 배경과 상품을 함께 보여 주되 카피는 차분하게 유지합니다.",
    scene: "고객이 상품을 사용하는 순간이 자연스럽게 연상되는 밝은 일상 공간",
    mood: ["자연스러운", "밝은", "공감"],
    textSafeArea: "top-right",
    productPosition: "bottom-left",
    backgroundTags: ["사용장면", "일상", "자연광", "공간"],
    risk: "카테고리와 맞지 않는 상황을 억지로 연결하지 않습니다.",
  },
];

function referenceText(labels: AdImageLabel[]) {
  return labels
    .flatMap((label) => {
      const final = label.finalLabel;
      return [final?.hookType, final?.appealPoint, final?.copyNuance, final?.consumerInsight, final?.purchaseTrigger, final?.whyItWorks];
    })
    .filter(Boolean)
    .join(" ");
}

function scoreSeed(seed: StrategySeed, brief: AdBrief, labels: AdImageLabel[]) {
  const pool = `${brief.desiredHookType || ""} ${brief.offerType || ""} ${brief.customerProblem || ""} ${brief.mainBenefit} ${brief.additionalEmphasis || ""} ${referenceText(labels)}`;
  let score = 0;
  if (seed.key === "value-proof" && /가격|할인|구성|가성비|특가|선물/.test(pool)) score += 5;
  if (seed.key === "problem-solution" && /문제|불편|고민|장벽|귀찮|해결/.test(pool)) score += 5;
  if (seed.key === "social-proof" && /후기|리뷰|반응|평점|재구매/.test(pool)) score += 5;
  if (seed.key === "curiosity" && /UGC|밈|반전|궁금|끊|유행|SNS/.test(pool)) score += 5;
  if (seed.key === "benefit-first" && brief.mainBenefit) score += 3;
  if (seed.key === "occasion" && /선물|모임|상황|부모님|집들이|출근|주말/.test(pool)) score += 4;
  if (brief.creativeIntensity === "performance" && ["value-proof", "problem-solution", "curiosity"].includes(seed.key)) score += 2;
  if (brief.creativeIntensity === "brand" && ["benefit-first", "occasion"].includes(seed.key)) score += 2;
  if (brief.adObjective === "purchase" && ["value-proof", "benefit-first", "problem-solution"].includes(seed.key)) score += 4;
  if (brief.adObjective === "signup" && ["benefit-first", "problem-solution", "curiosity"].includes(seed.key)) score += 4;
  if (brief.adObjective === "awareness" && ["benefit-first", "occasion", "curiosity"].includes(seed.key)) score += 4;
  if (brief.adObjective === "retargeting" && ["value-proof", "social-proof", "occasion"].includes(seed.key)) score += 4;
  return score;
}

function compact(value: string | undefined, maxLength: number) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const clause = text
    .split(/\s*[·|•]\s*|[.!?]\s+/)
    .map((part) => part.trim())
    .find((part) => part && part.length <= maxLength);
  if (clause) return clause;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function confirmedOffer(brief: AdBrief) {
  return [brief.discountInfo, brief.price]
    .map((value) => compact(value, 18))
    .filter(Boolean)
    .join(" · ");
}

function strategyAppeal(seed: StrategySeed, brief: AdBrief) {
  const productName = compact(brief.productName, 20) || "상품";
  const benefit = compact(brief.mainBenefit, 42);
  const offer = confirmedOffer(brief);

  if (seed.key === "value-proof") {
    return offer ? `확인된 구매 조건(${offer})과 상품 이점을 선명하게 전달` : `${productName}의 구성과 구매 이점을 명확하게 전달`;
  }
  if (seed.key === "problem-solution") {
    return benefit ? `고객의 고민을 ${benefit}과 연결해 해결 이유를 제시` : `${productName}이 필요한 고객 고민과 해결 이유를 연결`;
  }
  if (seed.key === "social-proof") {
    return `${productName}의 확인된 정보와 사용 맥락으로 선택 신뢰를 강화`;
  }
  if (seed.key === "curiosity") {
    return benefit ? `${benefit}이 왜 다른지 궁금하게 만드는 발견형 소구` : `${productName}의 차이점을 궁금하게 만드는 발견형 소구`;
  }
  if (seed.key === "occasion") {
    return `${brief.targetCustomer || "고객"}이 상품을 필요로 하는 순간과 사용 장면을 제안`;
  }
  return benefit ? `${benefit}을 핵심 차별점으로 가장 먼저 전달` : `${productName}의 핵심 차별점을 한눈에 전달`;
}

function strategyMainCopy(seed: StrategySeed, brief: AdBrief) {
  const productName = compact(brief.productName, 18) || "이 상품";
  const benefit = compact(brief.mainBenefit, 28);
  const offer = confirmedOffer(brief);

  if (seed.key === "value-proof") return offer || `${productName}, 선택할 이유가 분명해요`;
  if (seed.key === "problem-solution") return benefit ? `${benefit}, 고민을 덜어보세요` : `${productName}으로 고민을 덜어보세요`;
  if (seed.key === "social-proof") return `${productName}, 선별 기준부터 확인하세요`;
  if (seed.key === "curiosity") return benefit ? `${benefit}, 왜 다를까요?` : `${productName}, 무엇이 다를까요?`;
  if (seed.key === "occasion") return benefit ? `${benefit}, 필요한 순간에` : `${productName}, 필요한 순간에`;
  return benefit || `${productName}의 핵심 차이`;
}

function strategyAudience(brief: AdBrief) {
  const target = compact(brief.targetCustomer, 30) || "잠재 고객";
  if (brief.adObjective === "signup") return `상품을 처음 접하는 ${target}`;
  if (brief.adObjective === "awareness") return `브랜드를 아직 잘 모르는 ${target}`;
  if (brief.adObjective === "retargeting") return `상품을 본 적 있거나 재구매를 고민하는 ${target}`;
  return `구매를 비교하고 결정하려는 ${target}`;
}

function backgroundHookFor(seed: StrategySeed): NonNullable<CreativeStrategy["backgroundHookType"]> {
  const mapping: Record<AdHookType, NonNullable<CreativeStrategy["backgroundHookType"]>> = {
    "price-benefit": "price_offer",
    "feature-usp": "usp_proof",
    lifestyle: "situation",
    "season-event": "urgency",
    "problem-solution": "problem_solution",
    "social-proof": "review_ugc",
    curiosity: "usp_proof",
    sensory: "sensory",
    gift: "gifting",
    "brand-story": "origin_story",
  };
  return mapping[seed.hookType];
}

function preferredAssetsFor(seed: StrategySeed): NonNullable<CreativeStrategy["preferredAssetTypes"]> {
  const hook = backgroundHookFor(seed);
  if (["price_offer", "urgency"].includes(hook)) return ["product_set", "designed_asset", "pattern_texture"];
  if (["problem_solution", "review_ugc", "situation", "family"].includes(hook)) {
    return ["people_photo", "lifestyle_photo", "ai_generated"];
  }
  if (["sensory", "freshness"].includes(hook)) {
    return ["ingredient_scene", "product_set", "pattern_texture"];
  }
  return ["product_set", "ingredient_scene", "lifestyle_photo"];
}

export function buildCreativeStrategies(params: { brief: AdBrief; references: AdImageLabel[]; usages: ReferenceUsageSelection[]; batch?: number; product?: ProductInfoForPrompt }): CreativeStrategy[] {
  const batch = params.batch || 0;
  const scored = [...seeds].sort((a, b) => scoreSeed(b, params.brief, params.references) - scoreSeed(a, params.brief, params.references));
  const offset = (batch * 6) % scored.length;
  const ordered = [...scored.slice(offset), ...scored.slice(0, offset)];
  const unique = ordered.slice(0, 6);
  const referenceNames = params.references
    .map((label) => label.brandName || label.finalLabel?.hookType || label.imageId)
    .filter(Boolean)
    .join(", ");
  const usedAspects = Array.from(new Set(params.usages.flatMap((usage) => usage.aspects))).join(", ");
  const inferred = inferAdBriefContext({
    product: {
      productName: params.brief.productName,
      category: params.brief.category,
      price: params.brief.price,
      originalPrice: params.brief.originalPrice,
      discountInfo: params.brief.discountInfo,
      mainBenefit: params.brief.mainBenefit,
      targetCustomer: params.brief.targetCustomer,
      landingUrl: params.brief.landingUrl,
      productImagePath: "",
      backgroundImagePath: "",
    },
    brief: params.brief,
    references: params.references,
  });
  const matchedReferenceIds = params.references.map((label) => label.imageId);
  const matchedReferencePatterns = Array.from(new Set(params.references.flatMap((label) => [label.finalLabel?.hookType, label.finalLabel?.appealPoint, label.finalLabel?.reusableCopyPattern, label.finalLabel?.layoutPattern]).filter(Boolean) as string[])).slice(0, 5);

  const product: ProductInfoForPrompt = params.product || {
    productName: params.brief.productName,
    category: params.brief.category,
    price: params.brief.price,
    originalPrice: params.brief.originalPrice,
    oldPrice: params.brief.originalPrice,
    discountInfo: params.brief.discountInfo,
    mainBenefit: params.brief.mainBenefit,
    targetCustomer: params.brief.targetCustomer,
    landingUrl: params.brief.landingUrl,
    productImagePath: "",
    backgroundImagePath: "",
  };
  const productAnalysis = analyzeProductUsp(product);
  const objectiveProfile = getAdObjectiveProfile(params.brief.adObjective);

  return unique.map((seed, index) => {
    const targeted = buildTargetedStrategyContent({
      product,
      brief: params.brief,
      hookType: seed.hookType,
      index: index + batch * 6,
      targetIndex: index + batch * 6,
    });
    const appeal = productAnalysis.evidenceStrength === "limited" ? strategyAppeal(seed, params.brief) : targeted.appeal;
    const mainCopy = productAnalysis.evidenceStrength === "limited" ? strategyMainCopy(seed, params.brief) : targeted.headline;
    const audience = productAnalysis.targetSegments.length ? targeted.audience : strategyAudience(params.brief);
    return {
      id: `${seed.key}-${batch}-${index}`,
      title: seed.title,
      hookType: seed.hookType,
      headline: mainCopy,
      subCopy: appeal,
      keyAppeal: appeal,
      sceneDescription: seed.scene,
      mood: seed.mood,
      textSafeArea: seed.textSafeArea,
      productPosition: seed.productPosition,
      backgroundTags: seed.backgroundTags,
      appeal,
      mainCopy,
      audience,
      explanation: appeal,
      mainHookAngle: mainCopy,
      coreAppealPoint: appeal,
      audienceFit: audience,
      referenceFit: referenceNames ? `자동 매칭된 ${params.references.length}개 레퍼런스의 ${usedAspects || "후킹·소구·레이아웃 패턴"}만 참고하고 원문은 복제하지 않습니다.` : "관련 레퍼런스가 없어 상품 상세페이지의 사실 정보만 사용합니다.",
      suggestedVisualEmphasis: `${inferred.visualEmphasis}. ${seed.visual}`,
      risk: seed.risk,
      expectedCustomerProblem: targeted.targetTension || inferred.customerProblem,
      purchaseBarrierResponse: `${targeted.targetTension || inferred.purchaseBarrier}. 구매 근거: ${targeted.evidence || seed.appeal}`,
      recommendedTone: `${objectiveProfile.label}: ${objectiveProfile.messageSequence}. ${inferred.tone}`,
      inferredEvidence: Array.from(new Set([targeted.evidence, ...productAnalysis.proofSignals, ...inferred.proofElements].filter(Boolean))).slice(0, 6),
      matchedReferenceIds,
      matchedReferencePatterns,
      backgroundHookType: backgroundHookFor(seed),
      preferredAssetTypes: preferredAssetsFor(seed),
      preferredColors: [],
    };
  });
}

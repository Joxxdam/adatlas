import type { CategoryCreativeProfile, CategoryCreativeProfileId, HookHypothesisCandidate, ProductTruth } from "./types.ts";

type ProfileDefinition = Omit<CategoryCreativeProfile, "reason" | "matchedSignals"> & {
  terms: string[];
};

const commonAvoid = ["고정 템플릿이나 이전 광고의 1:1 복제", "상품이 거의 보이지 않는 장면", "검증되지 않은 가격·효능·후기·인증·수치", "문구만 바꾼 동일 구도 반복", "상품 원본과 다른 패키지·색상·수량"];

const definitions: Record<CategoryCreativeProfileId, ProfileDefinition> = {
  food_meat: {
    category: "food_meat",
    label: "육류·축산 식품",
    terms: ["한우", "소고기", "돼지고기", "삼겹살", "등심", "갈비", "육류", "축산", "불고기", "샤브"],
    visualObjectives: ["육즙·마블링·불향을 사실적으로 전달", "조리 행동과 구매 구성을 동시에 이해"],
    recommendedScenes: ["팬이나 그릴에서 지글거리는 조리 장면", "집게·젓가락으로 고기를 드는 초근접", "가족 식탁·캠핑·홈파티", "판매 패키지와 중량·가격 중심 커머스 히어로"],
    recommendedHumanUsage: ["굽는 손", "젓가락으로 먹는 행동", "함께 식사하는 가족"],
    productPresentation: ["원육 부위와 마블링 보존", "실제 판매 구성·팩 수량 보존", "조리 전후 상태를 임의로 바꾸지 않음"],
    typographyDirection: ["모바일에서 즉시 읽히는 대형 헤드라인", "가격형은 중량과 가격을 가장 선명하게"],
    colorDirection: ["음식의 실제 색을 우선", "후킹에 따라 따뜻한 불빛·식탁색 또는 고대비 커머스색"],
    compositionDirection: ["음식 초근접과 행동 순간", "패키지·완성 요리·메뉴 활용의 명확한 위계"],
    preferredVisualArchetypes: ["food-cooking-action", "food-sensory-macro", "food-menu-variety", "food-offer-hero", "food-convenience", "food-gift"],
    avoidList: [...commonAvoid, "플라스틱처럼 보이는 고기", "손가락·집게·젓가락 오류", "고기 부위나 생·조리 상태 변경"],
  },
  food_fresh: {
    category: "food_fresh",
    label: "신선식품·농산물",
    terms: ["농산", "청과", "과채", "과일", "채소", "사과", "복숭아", "자두", "포도", "수박", "배 ", "감귤", "귤", "오렌지", "레몬", "라임", "딸기", "멜론", "참외", "토마토", "고구마", "감자", "양파", "마늘", "버섯", "옥수수", "산지", "수확", "제철", "생과"],
    visualObjectives: ["신선함·질감·산지감을 사실적으로 전달", "크기·구성·먹는 순간을 명확하게 표현"],
    recommendedScenes: ["햇빛 아래 원물 초근접", "수확·세척·썰기·한입 장면", "박스 구성과 실제 수량", "가족 간식과 제철 식탁"],
    recommendedHumanUsage: ["수확하는 손", "과일을 자르거나 먹는 손", "가족 간식 장면"],
    productPresentation: ["표피·색·크기 편차를 자연스럽게 유지", "상자·낱개 구성 사실 보존"],
    typographyDirection: ["신선한 인상의 굵고 간결한 한글", "산지·제철·가격은 짧은 보조 정보"],
    colorDirection: ["원물 고유색과 자연광", "상품색을 살리는 보색 포인트"],
    compositionDirection: ["원물 질감이 보이는 근접 구도", "산지·섭취·구성 중 후킹에 맞는 한 장면 집중"],
    preferredVisualArchetypes: ["freshness-macro", "harvest-story", "human-tasting", "fresh-offer-hero", "table-serving", "gift-composition"],
    avoidList: [...commonAvoid, "표면이 플라스틱처럼 매끈한 원물", "실제 품종·수량·크기 왜곡"],
  },
  food_processed: {
    category: "food_processed",
    label: "가공식품·간편식",
    terms: ["간편식", "밀키트", "즉석", "냉동", "냉장", "소스", "음료", "주스", "과즙", "반찬", "시리얼", "가공식품", "식품", "스낵", "snack", "간식", "과자", "디저트", "건조", "반건조", "말랭이", "곶감"],
    visualObjectives: ["패키지와 완성 음식의 연결", "조리 편의·활용 메뉴·구매 혜택을 장면으로 설명"],
    recommendedScenes: ["포장을 열고 바로 조리하는 행동", "완성 메뉴 여러 가지", "퇴근 후 빠른 한 끼", "패키지 중심 가격·구성 히어로"],
    recommendedHumanUsage: ["포장을 여는 손", "간단히 조리하는 사람", "완성 음식을 먹는 장면"],
    productPresentation: ["패키지 라벨과 용량 보존", "원본에 없는 맛·옵션·구성 추가 금지"],
    typographyDirection: ["편의와 맛을 빠르게 이해하는 굵은 문구", "조리 시간·가격은 확인된 경우만 보조"],
    colorDirection: ["음식 고유색과 패키지 브랜드색 조화", "후킹별 따뜻한 식탁색 또는 선명한 커머스색"],
    compositionDirection: ["패키지→조리→완성 음식의 짧은 서사", "한 장면 안에서 제품 역할이 분명한 구성"],
    preferredVisualArchetypes: ["food-convenience", "food-cooking-action", "food-menu-variety", "food-offer-hero", "package-to-table", "social-proof-ugc"],
    avoidList: [...commonAvoid, "패키지와 전혀 다른 완성 음식", "먹을 수 없어 보이는 인공 질감"],
  },
  beauty_cosmetics: {
    category: "beauty_cosmetics",
    label: "화장품·스킨케어",
    terms: ["화장품", "스킨", "세럼", "앰플", "크림", "로션", "토너", "에센스", "쿠션", "립", "선크림", "메이크업"],
    visualObjectives: ["제품을 강한 히어로로 식별", "효능·질감·사용 결과를 감각적으로 시각화"],
    recommendedScenes: ["제품과 제형의 감각적 히어로", "손·얼굴·화장대 사용 장면", "성분·근거 인포그래픽", "문제와 사용 후 감정이 연결되는 장면"],
    recommendedHumanUsage: ["제형을 바르는 손", "화장대 사용", "효능을 설명하는 피부 근접"],
    productPresentation: ["용기 실루엣·라벨·색상 보존", "제품이 텍스트보다 먼저 식별되도록 크게"],
    typographyDirection: ["제품 무드에 맞는 편집형 대형 한글", "헤드라인 1초 가독성"],
    colorDirection: ["제품색과 연결된 강한 배경색", "제형과 효능을 살리는 명암·광택"],
    compositionDirection: ["제품 히어로·사람 행동·성분 증거 중 후킹에 맞게 선택", "텍스트와 제품이 경쟁하지 않는 위계"],
    preferredVisualArchetypes: ["sensory-immersion", "human-action", "product-hero", "ingredient-proof", "problem-solution", "social-proof-ugc"],
    avoidList: [...commonAvoid, "근거 없는 임상 수치나 효능", "피부·손·얼굴의 해부학적 오류"],
  },
  personal_care: {
    category: "personal_care",
    label: "퍼스널케어",
    terms: ["샤워젤", "바디워시", "샴푸", "트리트먼트", "데오드란트", "치약", "세정", "비누", "핸드워시", "퍼스널케어", "민트 티트리"],
    visualObjectives: ["향·쿨링·거품·상쾌함을 눈으로 체감", "제품과 실제 사용 상황을 직접 연결"],
    recommendedScenes: ["물보라·얼음·거품·수증기 속 제품 히어로", "운동 후·샤워 전후 사람 행동", "손에 제품을 쥔 사용 장면", "검증된 성분·후기 증거"],
    recommendedHumanUsage: ["운동 후 땀을 식히는 사람", "샤워 중 또는 샤워 후", "제품을 강하게 쥔 손"],
    productPresentation: ["패키지 형태·라벨·제품색 고식별", "동일 제품 반복은 후킹이 요구할 때만"],
    typographyDirection: ["대형 3D·반복·레이어·만화적 강조를 후킹에 맞게 허용", "모바일 즉시 가독성 우선"],
    colorDirection: ["제품색과 대비되는 청량·감각 색", "후킹별 냉기·온기·생활 공간 색을 다르게"],
    compositionDirection: ["제품 히어로와 감각 효과", "사람은 장식이 아니라 문제·해결을 설명"],
    preferredVisualArchetypes: ["sensory-immersion", "human-action", "product-hero", "social-proof-ugc", "ingredient-proof", "problem-solution"],
    avoidList: [...commonAvoid, "근거 없는 체감온도·체취감소 수치", "제품을 가리는 과도한 효과", "샤워 장면의 손·신체 오류"],
  },
  fashion: {
    category: "fashion",
    label: "패션",
    terms: ["패션", "의류", "원피스", "셔츠", "바지", "재킷", "코트", "신발", "가방", "주얼리", "착용"],
    visualObjectives: ["실루엣·핏·소재를 정확히 전달", "착용 상황과 스타일 정체성을 후킹에 연결"],
    recommendedScenes: ["전신 착장", "소재·봉제 디테일", "출근·여행·데이트 상황", "스타일링 전후"],
    recommendedHumanUsage: ["자연스러운 전신 모델", "걷거나 입는 행동", "가방·신발 실제 사용"],
    productPresentation: ["색상·패턴·길이·실루엣 보존", "착용 시 제품이 가려지지 않게"],
    typographyDirection: ["패션 에디토리얼형 한글", "상품 실루엣을 침범하지 않는 대형 제목"],
    colorDirection: ["원단색과 피부톤 정확성", "브랜드 무드 중심의 절제된 대비"],
    compositionDirection: ["전신·중경·디테일 중 메시지에 맞는 거리", "움직임과 여백을 활용한 편집 구도"],
    preferredVisualArchetypes: ["fashion-editorial", "human-action", "detail-proof", "problem-solution", "style-comparison", "offer-impact"],
    avoidList: [...commonAvoid, "팔다리·손가락 오류", "원단 패턴·상품 길이·색상 변경"],
  },
  health: {
    category: "health",
    label: "건강·웰니스",
    terms: ["건강", "영양제", "비타민", "유산균", "보충제", "프로틴", "단백질", "건기식", "헬스"],
    visualObjectives: ["복용·운동·일상 루틴을 신뢰감 있게 표현", "허용된 성분·함량·인증만 증거화"],
    recommendedScenes: ["아침 건강 루틴", "운동 전후 사용", "성분·함량 증거", "패키지 중심 신뢰 히어로"],
    recommendedHumanUsage: ["복용 준비", "운동 후 섭취", "건강한 일상 행동"],
    productPresentation: ["패키지와 섭취 형태 보존", "복용량·효능을 임의 생성하지 않음"],
    typographyDirection: ["신뢰감 있는 굵은 산세리프", "성분 정보는 짧고 명확하게"],
    colorDirection: ["깨끗한 중성색과 브랜드 포인트", "과도한 의료 이미지 금지"],
    compositionDirection: ["생활 루틴과 제품 역할", "검증 근거가 있을 때만 인포그래픽"],
    preferredVisualArchetypes: ["routine-lifestyle", "ingredient-proof", "product-hero", "human-action", "problem-solution", "social-proof-ugc"],
    avoidList: [...commonAvoid, "질병 치료·예방 암시", "근거 없는 전후 변화나 의료 수치"],
  },
  household: {
    category: "household",
    label: "생활용품",
    terms: ["생활용품", "세제", "청소", "수납", "주방용품", "욕실용품", "휴지", "탈취", "살균", "가전"],
    visualObjectives: ["사용 전 불편과 사용 행동을 명확히 설명", "크기·구성·기능을 실제 생활 공간에서 전달"],
    recommendedScenes: ["집 안 문제 상황", "손으로 사용하는 순간", "정리·청소 전후", "구성품과 기능 증거"],
    recommendedHumanUsage: ["제품을 쓰는 손", "집안일을 줄이는 행동", "가족 생활 장면"],
    productPresentation: ["형태·재질·구성품 보존", "실제 사용 방식과 다른 연출 금지"],
    typographyDirection: ["문제와 해결이 즉시 읽히는 굵은 문구", "기능은 하나의 보조 증거"],
    colorDirection: ["생활 공간의 자연색과 기능 포인트색", "청결감을 위한 명확한 대비"],
    compositionDirection: ["문제→행동→해결 흐름", "제품 사용 부위를 가리지 않는 구성"],
    preferredVisualArchetypes: ["problem-solution", "functional-demo", "human-action", "product-hero", "before-after", "offer-impact"],
    avoidList: [...commonAvoid, "불가능한 사용 장면", "근거 없는 살균·탈취 수치"],
  },
  kids: {
    category: "kids",
    label: "키즈·육아",
    terms: ["키즈", "유아", "아동", "어린이", "베이비", "육아", "장난감", "기저귀", "분유"],
    visualObjectives: ["보호자 관점의 사용 이유와 안전한 사용 상황", "연령·구성·재질을 정확하게 표현"],
    recommendedScenes: ["보호자와 아이의 생활 장면", "놀이·외출·수면 루틴", "제품 기능 시연", "구성품 히어로"],
    recommendedHumanUsage: ["보호자 손", "연령에 맞는 자연스러운 사용", "가족 상호작용"],
    productPresentation: ["연령·수량·구성 보존", "안전 인증은 확인된 경우만"],
    typographyDirection: ["친근하지만 명확한 한글", "과도하게 유아적인 장식보다 모바일 가독성"],
    colorDirection: ["밝고 안전한 생활색", "제품색과 부드러운 대비"],
    compositionDirection: ["사용자와 제품의 관계", "아이 얼굴보다 상품 역할이 분명한 구성"],
    preferredVisualArchetypes: ["family-lifestyle", "human-action", "functional-demo", "product-hero", "problem-solution", "social-proof-ugc"],
    avoidList: [...commonAvoid, "연령에 맞지 않는 사용", "위험한 자세·행동", "가짜 안전 인증"],
  },
  general: {
    category: "general",
    label: "일반 상품",
    terms: [],
    visualObjectives: ["상품의 구매 이유와 사용 상황을 한눈에 전달", "상품 식별성과 한국어 가독성 확보"],
    recommendedScenes: ["상품 히어로", "실제 사용 행동", "문제 해결 장면", "검증 근거·혜택 장면"],
    recommendedHumanUsage: ["사용법을 설명하는 자연스러운 손 또는 사람"],
    productPresentation: ["형태·색상·라벨·구성 보존", "상품을 화면의 핵심 피사체로 사용"],
    typographyDirection: ["후킹 감정에 맞는 대형 한글", "메인·서브·근거·CTA 4단계 이내"],
    colorDirection: ["상품색과 브랜드 분위기 중심", "텍스트 대비 확보"],
    compositionDirection: ["후킹→상황→상품 역할이 직접 이어지는 구도", "모바일에서 제품과 문구가 경쟁하지 않는 위계"],
    preferredVisualArchetypes: ["product-hero", "human-action", "problem-solution", "editorial-lifestyle", "ingredient-proof", "offer-impact"],
    avoidList: commonAvoid,
  },
};

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCategoryCreativeProfile(truth: ProductTruth): CategoryCreativeProfile {
  const product = truth.product;
  const sources = [
    { value: `${product.category} ${product.productSubCategory || ""} ${product.detectedProductType || ""}`, weight: 8, label: "카테고리" },
    { value: `${product.productName} ${product.extractedDescription || ""}`, weight: 5, label: "상품명·상세설명" },
    {
      value: `${product.mainBenefit || ""} ${product.targetCustomer || ""} ${(product.verifiedBenefits || []).join(" ")} ${(product.ingredients || []).join(" ")} ${(product.creativeContext?.recommendationReasons || []).join(" ")} ${(product.creativeContext?.reviewInsightSummaries || []).join(" ")}`,
      weight: 3,
      label: "USP·사용상황·고객문제",
    },
    { value: truth.facts.map((fact) => `${fact.label} ${fact.value}`).join(" "), weight: 2, label: "상세페이지 근거" },
    { value: truth.imageAssets.flatMap((asset) => asset.classificationSignals || []).join(" "), weight: 2, label: "이미지 특징" },
    { value: `${product.brandName || product.advertiserName || ""} ${(product.brandColors || []).join(" ")} ${(product.creativeContext?.appliedContentNotes || []).map((note) => note.content).join(" ")}`, weight: 1, label: "브랜드 분위기" },
  ].map((source) => ({ ...source, value: normalized(source.value) }));
  const scored = Object.values(definitions)
    .filter((profile) => profile.category !== "general")
    .map((profile) => {
      const matches: string[] = [];
      let score = 0;
      for (const source of sources) {
        const hit = profile.terms.filter((term) => source.value.includes(normalized(term)));
        if (!hit.length) continue;
        score += source.weight * Math.min(3, hit.length);
        matches.push(`${source.label}: ${hit.slice(0, 3).join("·")}`);
      }
      return { profile, score, matches };
    })
    .sort((left, right) => right.score - left.score);
  const selected = scored[0]?.score ? scored[0] : { profile: definitions.general, score: 0, matches: ["분류 근거 부족"] };
  const profile = Object.fromEntries(Object.entries(selected.profile).filter(([key]) => key !== "terms")) as Omit<ProfileDefinition, "terms">;
  return {
    ...profile,
    matchedSignals: selected.matches,
    reason: selected.score ? `${selected.matches.join(" / ")}를 함께 분석해 ${profile.label} 광고 문법을 선택했습니다.` : "상품명뿐 아니라 카테고리·USP·상세 근거·이미지 특징을 확인했으나 특화 분류 근거가 부족해 일반 광고 문법을 사용합니다.",
  };
}

function hasEvidence(candidate: HookHypothesisCandidate, pattern: RegExp) {
  return candidate.verifiedEvidence.some((value) => pattern.test(value));
}

function preferredArchetype(candidate: HookHypothesisCandidate, profile: CategoryCreativeProfile) {
  const text = normalized(`${candidate.primaryTag} ${candidate.hypothesis} ${candidate.visualConcept} ${candidate.customerTension}`);
  if (candidate.primaryTag === "review-trust" && hasEvidence(candidate, /후기|리뷰|평점|review/i)) return "social-proof-ugc";
  if (candidate.primaryTag === "price-value" || candidate.primaryTag === "bundle-choice" || /가격|할인|구성|혜택/.test(text)) return profile.category.startsWith("food_") ? "food-offer-hero" : "offer-impact";
  if (candidate.primaryTag === "problem-solution" || /불편|고민|문제|해결/.test(text)) return "problem-solution";
  if (candidate.primaryTag === "feature-usp" || candidate.primaryTag === "brand-origin" || /성분|원료|근거|인증/.test(text)) return "ingredient-proof";
  if (profile.category === "food_meat" && /맛|육즙|마블|식감|향/.test(text)) return "food-sensory-macro";
  if (profile.category.startsWith("food_") && /조리|굽|먹|식사/.test(text)) return "food-cooking-action";
  if (candidate.primaryTag === "sensory-experience") return "sensory-immersion";
  if (["usage-occasion", "target-identity", "convenience"].includes(candidate.primaryTag)) return "human-action";
  return profile.preferredVisualArchetypes[0] || "product-hero";
}

function needsHuman(archetype: string, candidate: HookHypothesisCandidate) {
  return /human|action|cooking|tasting|lifestyle|problem|convenience|harvest|table|family/.test(archetype) || /사람|손|운동|샤워|조리|먹|사용|출근|가족/.test(candidate.visualConcept);
}

function archetypeAllowed(archetype: string, truth: ProductTruth, candidate: HookHypothesisCandidate) {
  const verified = truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified");
  if (archetype === "social-proof-ugc") {
    return candidate.primaryTag === "review-trust" && verified.some((fact) => fact.evidenceType === "review" || /후기|리뷰|평점/i.test(`${fact.key} ${fact.label}`));
  }
  if (/offer/.test(archetype)) {
    return verified.some((fact) => /price|discount|coupon|shipping|bundle|option|가격|할인|쿠폰|배송|구성|세트/i.test(`${fact.key} ${fact.label}`));
  }
  if (archetype === "ingredient-proof") {
    return verified.some((fact) => /ingredient|benefit|origin|cert|material|성분|원료|혜택|원산지|인증|소재/i.test(`${fact.key} ${fact.label}`));
  }
  return true;
}

export function applyCategoryCreativeDirection(truth: ProductTruth, candidates: HookHypothesisCandidate[], profile = resolveCategoryCreativeProfile(truth)) {
  const used = new Set<string>();
  return candidates.map((candidate, index) => {
    let archetype = preferredArchetype(candidate, profile);
    if (!archetypeAllowed(archetype, truth, candidate)) {
      archetype = profile.preferredVisualArchetypes.find((value) => archetypeAllowed(value, truth, candidate)) || "product-hero";
    }
    if (used.has(archetype)) {
      const alternative = profile.preferredVisualArchetypes.find((value) => !used.has(value) && archetypeAllowed(value, truth, candidate));
      if (alternative) archetype = alternative;
    }
    used.add(archetype);
    const humanRole = needsHuman(archetype, candidate) ? profile.recommendedHumanUsage[index % Math.max(1, profile.recommendedHumanUsage.length)] || "상품 사용 행동을 설명하는 자연스러운 사람 또는 손" : "사람 없이 상품과 감각·근거가 주인공";
    const scene = candidate.visualConcept || profile.recommendedScenes[index % profile.recommendedScenes.length];
    const referenceImageIds = [...truth.imageAssets, ...truth.referenceImages]
      .filter((asset) => asset.verified && asset.validationStatus !== "excluded" && asset.role !== "product-cutout")
      .sort((left, right) => {
        const score = (role: string) => (role === "product-packshot" ? 5 : role === "product-lifestyle" ? 4 : role === "detail-image" ? 3 : 1);
        return score(right.role) - score(left.role);
      })
      .slice(0, 5)
      .map((asset) => asset.id);
    return {
      ...candidate,
      creativeBrief: {
        ...candidate.creativeBrief,
        targetCustomer: truth.product.targetCustomer || "상세페이지에서 확인되는 핵심 고객",
        customerSituation: candidate.customerTension,
        intendedReaction: candidate.intendedReaction,
        visualArchetype: archetype,
        heroScene: scene,
        sceneDescription: scene,
        humanRole,
        productRole: profile.productPresentation[index % profile.productPresentation.length] || "실제 판매 상품을 핵심 피사체로 사용",
        cameraAngle: /macro|sensory/.test(archetype) ? "질감과 상품을 함께 보여주는 다이내믹 초근접" : /offer|hero|proof/.test(archetype) ? "패키지 정면이 선명한 프런트 히어로" : "행동과 상품이 함께 읽히는 3/4 시점",
        cameraDirection: /macro|sensory/.test(archetype) ? "질감과 상품을 함께 보여주는 다이내믹 초근접" : "상품 형태를 왜곡하지 않는 상업 광고 시점",
        composition: profile.compositionDirection[index % profile.compositionDirection.length],
        colorPalette: profile.colorDirection[index % profile.colorDirection.length],
        colorDirection: profile.colorDirection[index % profile.colorDirection.length],
        lighting: profile.category.startsWith("food_") ? "음식의 윤기·수분·질감을 살리는 사실적인 방향성 조명" : "제품 재질과 후킹의 감각을 살리는 고대비 상업 조명",
        lightingDirection: profile.category.startsWith("food_") ? "음식의 윤기·수분·질감을 살리는 사실적인 방향성 조명" : "제품 재질과 후킹의 감각을 살리는 고대비 상업 조명",
        typographyDirection: profile.typographyDirection[index % profile.typographyDirection.length],
        typographyStyle: profile.typographyDirection[index % profile.typographyDirection.length],
        supportingElements: profile.recommendedScenes.slice(index % Math.max(1, profile.recommendedScenes.length), (index % Math.max(1, profile.recommendedScenes.length)) + 2),
        prohibitedClaims: [...new Set([...candidate.prohibitedClaims, ...truth.unverifiedClaims, ...truth.blockedClaimPatterns])].slice(0, 30),
        forbiddenElements: [...new Set([...candidate.creativeBrief.forbiddenElements, ...profile.avoidList])],
        differentiationReason: `${candidate.sceneKey || candidate.id} 장면과 ${archetype} 문법을 사용하며 다른 후킹과 카메라·제품 배치·타이포그래피를 반복하지 않음`,
        differentiationFromOtherHooks: `${candidate.sceneKey || candidate.id} 장면과 ${archetype} 문법을 사용하며 다른 후킹과 카메라·제품 배치·타이포그래피를 반복하지 않음`,
        referenceImageIds,
      },
    };
  });
}

export function countDistinctVisualArchetypes(candidates: HookHypothesisCandidate[]) {
  return new Set(candidates.map((candidate) => candidate.creativeBrief.visualArchetype).filter(Boolean)).size;
}

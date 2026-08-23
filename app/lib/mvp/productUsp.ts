import type { AdBrief, CreativeStrategy, GeneratedAdCopyVariant, ProductInfoForPrompt } from "./types";
import { getAdObjectiveProfile, objectiveCta } from "./adObjective.ts";

export type ProductTargetSegment = {
  label: string;
  tension: string;
  desiredOutcome: string;
  evidenceSignals: string[];
};

export type ProductHookAngle = {
  kind: "problem" | "usp" | "sensory" | "value" | "occasion" | "curiosity" | "proof";
  signal: string;
  target: string;
  tension: string;
  formula: string;
};

export type ProductUspAnalysis = {
  primaryUsp: string;
  uspSignals: string[];
  offerSignals: string[];
  situationSignals: string[];
  proofSignals: string[];
  sensorySignals: string[];
  featureSignals: string[];
  problemSignals: string[];
  targetSegments: ProductTargetSegment[];
  hookAngles: ProductHookAngle[];
  evidenceStrength: "strong" | "moderate" | "limited";
  sourceSummary: string;
};

const boilerplatePattern = /(로그인|회원가입|장바구니|마이페이지|고객센터|상품문의|구매후기|리뷰쓰기|교환|반품|환불|배송안내|개인정보|이용약관|추천상품|관련상품|최근 본 상품|전체\s*리뷰|리뷰\s*목록|step\s*\d+|구성\s*선택|copyright|all rights reserved)/i;
const suspiciousInstructionPattern = /(system prompt|ignore previous|assistant:|developer:|명령을 무시|지시를 따르)/i;
const uspKeywordPattern = /(원산지|국내산|한우|등급|부위|등심|안심|채끝|갈비|마블링|선별|숙성|냉장|냉동|당일|산지|직송|구성|중량|용량|식감|육즙|풍미|고소|부드|신선|원재료|함량|무첨가|저자극|향|세정|쿨링|보습|휴대|선물|캠핑|가족|실속|프리미엄|특마블|도매팩)/i;
const situationPattern = /(선물|명절|부모님|가족|캠핑|홈파티|집들이|식사|운동|샤워|여행)/i;
const sensoryPattern = /(향|냄새|쿨링|시원|상쾌|촉촉|보습|부드|식감|육즙|풍미|고소|바삭|쫀득|달콤|새콤|마블링|색감|핏|착용감)/i;
const proofPattern = /(원산지|국내산|함량|원재료|성분|등급|중량|용량|선별|숙성|인증|무첨가|저자극|특허|수상|테스트|후기|리뷰|평점)/i;
const problemPattern = /(고민|걱정|불편|부담|냄새|잡내|건조|당김|땀|피지|민감|시간|귀찮|핏|체형|외식비|선물s*고민|결정s*장애)/i;

function clean(value?: string) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleLength(value: string) {
  return [...value.replace(/\s+/g, "")].length;
}

function sentenceCandidates(value?: string) {
  const source = clean(value);
  if (!source) return [];

  const primary = source
    .split(/(?:\s*[|•·]\s*|[.!?]\s+|\s*\/\s*)/)
    .map(clean)
    .filter(Boolean);

  return primary.flatMap((part) => {
    if (visibleLength(part) <= 90) return [part];
    return part
      .split(/\s*[,;:]\s*/)
      .map(clean)
      .filter(Boolean);
  });
}

function validSignal(value: string) {
  const length = visibleLength(value);
  if (length < 4 || length > 110) return false;
  if (boilerplatePattern.test(value) || suspiciousInstructionPattern.test(value)) return false;
  if (/너무[ㅜㅠㅋㅎ]*\s*좋|중요부위|샴푸\s*너무|리뷰.*리뷰.*리뷰/i.test(value)) return false;
  if (/^(상품|제품|상세|정보|설명|홈)$/.test(value)) return false;
  return true;
}

function signalScore(value: string, productName: string, sourceRank: number) {
  let score = sourceRank;
  if (uspKeywordPattern.test(value)) score += 8;
  if (/\d/.test(value)) score += 2;
  if (productName && value.includes(productName)) score += 2;
  if (situationPattern.test(value)) score += 1;
  if (visibleLength(value) >= 12 && visibleLength(value) <= 60) score += 2;
  return score;
}

function unique(values: string[]) {
  const result: string[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const key = value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    result.push(value);
  }
  return result;
}

function reviewSignals(product: ProductInfoForPrompt) {
  return unique(
    (product.reviewSources || [])
      .filter((review) => review.keySentence && review.classificationConfidence >= 0.55)
      .map((review) => clean(review.keySentence))
      .filter(validSignal)
  ).slice(0, 4);
}

function explicitSignals(product: ProductInfoForPrompt) {
  return unique([...(product.verifiedBenefits || []).map(clean), ...(product.ingredients || []).map((value) => clean(value))]).filter(validSignal);
}

function inferTargetSegments(product: ProductInfoForPrompt, signals: string[], situations: string[]): ProductTargetSegment[] {
  const facts = clean([product.productName, product.category, product.targetCustomer, ...signals, ...situations].join(" "));
  const primary = signals[0] || clean(product.productName) || "상품 정보";
  const secondary = signals[1] || primary;
  const explicitTarget = clean(product.targetCustomer);
  const segments: ProductTargetSegment[] = [];
  const add = (label: string, tension: string, desiredOutcome: string, evidence: string[]) => {
    const key = `${label}|${tension}`;
    if (segments.some((segment) => `${segment.label}|${segment.tension}` === key)) return;
    segments.push({
      label,
      tension,
      desiredOutcome,
      evidenceSignals: unique(evidence).slice(0, 3),
    });
  };

  if (explicitTarget) {
    add(explicitTarget, "비슷한 상품의 차이를 고르기 어려움", primary, [primary]);
  }
  if (/(샤워|바디|화장품|뷰티|스킨|세정|향|쿨링|보습)/i.test(facts)) {
    if (/(땀|냄새|피지|건조|당김|민감)/i.test(facts)) {
      const concern = facts.match(/땀s*냄새|냄새|피지|건조|당김|민감/i)?.[0] || "샤워 뒤 개운함";
      add(`${concern}이 신경 쓰이는 고객`, `${concern} 때문에 제품을 바꿔도 만족하기 어려움`, primary, [primary, secondary]);
    }
    add("향과 사용감을 중요하게 보는 고객", "기능만큼 실제 사용 순간의 감각도 중요함", secondary, [secondary, primary]);
    add("성분과 차별점을 비교하는 고객", "비슷해 보이는 제품 사이에서 고를 근거가 필요함", primary, [primary]);
  } else if (/(한우|고기|육|등심|안심|채끝|갈비|식품|농가|과일|채소|농산)/i.test(facts)) {
    add("가격과 구성을 비교하는 실속 구매자", "가격만 보고 고르면 품질이 아쉬울까 걱정됨", primary, [primary, product.price || ""]);
    add("맛과 품질 기준이 분명한 고객", "사진만으로는 식감과 품질 차이를 판단하기 어려움", secondary, [secondary, primary]);
    add("가족 식사나 선물을 준비하는 고객", "실패 없이 내놓을 구매 명분이 필요함", situations[0] || primary, [situations[0] || primary]);
  } else if (/(패션|의류|원피스|블라우스|팬츠|스커트|자켓|니트|코디|핏)/i.test(facts)) {
    add("체형과 핏을 꼼꼼히 보는 고객", "예뻐 보여도 실제 핏이 어울릴지 걱정됨", primary, [primary, secondary]);
    add("코디 시간을 줄이고 싶은 고객", "가지고 있는 옷과 쉽게 매치할 기준이 필요함", secondary, [secondary]);
    add("출근·모임용 옷을 찾는 고객", "한 번 입고 마는 옷보다 활용할 장면이 중요함", situations[0] || primary, [situations[0] || primary]);
  } else {
    add("비슷한 상품을 비교 중인 고객", "상품마다 비슷해 보여 선택 기준이 필요함", primary, [primary]);
    add("실사용 이점을 먼저 보는 고객", "기능 설명보다 내 생활에서 달라지는 점이 궁금함", secondary, [secondary]);
    add("구매를 망설이는 고객", "가격과 효용이 납득되어야 결정을 내릴 수 있음", primary, [primary, product.price || ""]);
  }
  return segments.slice(0, 4);
}

function buildHookAngles(params: { primary: string; signals: string[]; offers: string[]; situations: string[]; sensory: string[]; proof: string[]; problems: string[]; targets: ProductTargetSegment[] }) {
  const target = (index: number) => params.targets[index % Math.max(1, params.targets.length)];
  const candidates: ProductHookAngle[] = [];
  const add = (kind: ProductHookAngle["kind"], signal: string, index: number, formula: string) => {
    const segment = target(index) || {
      label: "상품을 비교하는 고객",
      tension: "선택 기준이 필요함",
      desiredOutcome: signal,
    };
    if (!signal || candidates.some((candidate) => candidate.kind === kind && candidate.signal === signal)) return;
    candidates.push({ kind, signal, target: segment.label, tension: segment.tension, formula });
  };
  add("problem", params.problems[0] || params.primary, 0, "타겟의 신경 쓰이는 문제를 찌른 뒤 확인된 USP로 전환");
  add("usp", params.proof[0] || params.signals[1] || params.primary, 1, "비교 기준이 되는 구체적 근거를 첫 문장에 제시");
  add("sensory", params.sensory[0] || params.signals[2] || params.primary, 2, "사용 순간에 느낄 감각과 장면을 구체적으로 환기");
  add("value", params.offers[0] || params.signals[3] || params.primary, 0, "확인된 가격·구성과 효용을 묶어 구매 명분 제시");
  add("occasion", params.situations[0] || params.signals[4] || params.primary, 2, "상품이 필요한 정확한 순간을 먼저 제안");
  add("curiosity", params.signals[5] || params.signals[1] || params.primary, 1, "구체적 차이 하나를 숨기지 않으면서 이유를 궁금하게 구성");
  if (params.proof[1]) add("proof", params.proof[1], 1, "상세페이지의 검증 가능한 근거로 선택 불안 해소");
  return candidates;
}

export function analyzeProductUsp(product: ProductInfoForPrompt): ProductUspAnalysis {
  const productName = clean(product.productName);
  const ranked = [...explicitSignals(product).map((value) => ({ value, sourceRank: 11 })), ...sentenceCandidates(product.mainBenefit).map((value) => ({ value, sourceRank: 8 })), ...sentenceCandidates(product.extractedDescription).map((value) => ({ value, sourceRank: 5 })), ...reviewSignals(product).map((value) => ({ value, sourceRank: 4 }))].filter((item) => validSignal(item.value)).sort((a, b) => signalScore(b.value, productName, b.sourceRank) - signalScore(a.value, productName, a.sourceRank));
  const uspSignals = unique(ranked.map((item) => item.value)).slice(0, 12);
  const offerSignals = unique([product.discountInfo, product.price, product.originalPrice || product.oldPrice].map(clean).filter(Boolean));
  const situationSignals = uspSignals.filter((signal) => situationPattern.test(signal)).slice(0, 3);
  const primaryUsp = uspSignals[0] || productName || clean(product.category) || "상품 핵심 정보";
  const proofSignals = uspSignals.filter((signal) => proofPattern.test(signal)).slice(0, 5);
  const sensorySignals = uspSignals.filter((signal) => sensoryPattern.test(signal)).slice(0, 5);
  const problemSignals = uspSignals.filter((signal) => problemPattern.test(signal)).slice(0, 5);
  const featureSignals = uspSignals.filter((signal) => !situationPattern.test(signal) && !problemPattern.test(signal)).slice(0, 6);
  const targetSegments = inferTargetSegments(product, uspSignals, situationSignals);
  const hookAngles = buildHookAngles({
    primary: primaryUsp,
    signals: uspSignals,
    offers: offerSignals,
    situations: situationSignals,
    sensory: sensorySignals,
    proof: proofSignals,
    problems: problemSignals,
    targets: targetSegments,
  });

  return {
    primaryUsp,
    uspSignals,
    offerSignals,
    situationSignals,
    proofSignals,
    sensorySignals,
    featureSignals,
    problemSignals,
    targetSegments,
    hookAngles,
    evidenceStrength: uspSignals.length >= 5 ? "strong" : uspSignals.length >= 2 ? "moderate" : "limited",
    sourceSummary: unique([primaryUsp, ...uspSignals.slice(1, 4), ...offerSignals]).join(" · "),
  };
}

const genericHookTokens = new Set(["상품", "제품", "가격", "특가", "구성", "확인", "선택", "이유", "지금", "오늘", "정말", "진짜"]);

export function isCopyGroundedInProductUsp(value: string, product: ProductInfoForPrompt) {
  const copy = clean(value).toLowerCase();
  if (!copy) return false;
  const analysis = analyzeProductUsp(product);
  const source = [product.productName, ...analysis.uspSignals, ...analysis.offerSignals].map(clean).join(" ");
  const tokens = Array.from(source.matchAll(/[0-9a-z가-힣]+/gi))
    .map((match) => match[0].toLowerCase())
    .filter((token) => token.length >= 2 && !genericHookTokens.has(token));
  if (!tokens.length) return true;
  return tokens.some((token) => copy.includes(token));
}

function compactPhrase(value: string, maxLength: number) {
  const source = clean(value);
  if (visibleLength(source) <= maxLength) return source;
  const clauses = source
    .split(/\s*[,;:]\s*/)
    .map(clean)
    .filter((part) => part && visibleLength(part) <= maxLength);
  if (clauses[0]) return clauses[0];

  const words = source.split(/\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    if (visibleLength([...selected, word].join(" ")) > maxLength) break;
    selected.push(word);
  }
  return selected.join(" ") || source;
}

function targetAwareAngle(analysis: ProductUspAnalysis, hookType: CreativeStrategy["hookType"], index: number) {
  const kindByHook: Record<CreativeStrategy["hookType"], ProductHookAngle["kind"]> = {
    "price-benefit": "value",
    "feature-usp": "usp",
    lifestyle: "occasion",
    "season-event": "occasion",
    "problem-solution": "problem",
    "social-proof": "proof",
    curiosity: "curiosity",
    sensory: "sensory",
    gift: "occasion",
    "brand-story": "proof",
  };
  const preferredKind = kindByHook[hookType];
  const matched = analysis.hookAngles.find((angle) => angle.kind === preferredKind);
  if (matched) return matched;

  const fallbackSignals: Record<ProductHookAngle["kind"], string> = {
    value: analysis.offerSignals[0] || analysis.uspSignals[index] || analysis.primaryUsp,
    problem: analysis.problemSignals[0] || analysis.uspSignals[index] || analysis.primaryUsp,
    sensory: analysis.sensorySignals[0] || analysis.uspSignals[index] || analysis.primaryUsp,
    occasion: analysis.situationSignals[0] || analysis.uspSignals[index] || analysis.primaryUsp,
    proof: analysis.proofSignals[0] || analysis.uspSignals[index] || analysis.primaryUsp,
    curiosity: analysis.uspSignals[index] || analysis.primaryUsp,
    usp: analysis.uspSignals[index] || analysis.primaryUsp,
  };
  return {
    kind: preferredKind,
    signal: fallbackSignals[preferredKind],
    target: analysis.targetSegments[0]?.label || "상품을 비교하는 고객",
    tension: analysis.targetSegments[0]?.tension || "선택 기준이 필요함",
    formula: `${preferredKind} 관점으로 확인된 상품 차이를 제시`,
  };
}

function sentenceEnding(value: string) {
  return clean(value)
    .replace(/필요함$/g, "필요한 상황")
    .replace(/어려움$/g, "어려운 상황")
    .replace(/중요함$/g, "중요한 상황")
    .replace(/걱정됨$/g, "걱정되는 상황")
    .replace(/됨$/g, "되는 상황");
}

function objectiveAudience(objective: AdBrief["adObjective"], target: string) {
  if (objective === "signup") return `상품을 처음 접하는 ${target}`;
  if (objective === "awareness") return `브랜드를 아직 잘 모르는 ${target}`;
  if (objective === "retargeting") return `상품을 이미 본 ${target}`;
  return `구매를 비교 중인 ${target}`;
}

function objectiveHeadline(params: { objective: AdBrief["adObjective"]; angleKind: ProductHookAngle["kind"]; evidence: string; tension: string; brand: string; strong: boolean; baseHeadline: string }) {
  const { objective, angleKind, evidence, tension, brand, strong, baseHeadline } = params;
  if (objective === "signup") {
    if (angleKind === "problem") return `${tension}? ${evidence}부터 보세요`;
    if (angleKind === "sensory") return `${evidence}, 처음부터 느껴지는 차이`;
    if (angleKind === "occasion") return `${evidence}, 이럴 때 필요한 이유`;
    if (angleKind === "curiosity") return `${evidence}, 처음이라면 왜 다를까요?`;
    return `처음 고른다면, ${evidence}부터`;
  }
  if (objective === "awareness") {
    if (angleKind === "sensory") return `${brand}, ${evidence}의 감각`;
    if (angleKind === "occasion") return `${evidence}의 순간, ${brand}`;
    if (angleKind === "curiosity") return `${brand}를 기억할 한 가지, ${evidence}`;
    return `${brand}의 대표 기억점, ${evidence}`;
  }
  if (objective === "retargeting") {
    if (angleKind === "problem") return `아직 ${tension}? ${evidence}를 다시 보세요`;
    if (angleKind === "value") return `${evidence}, 다시 볼 구매 조건`;
    if (angleKind === "sensory") return `${evidence}, 다시 떠올릴 차이`;
    return `다시 볼 이유, ${evidence}`;
  }
  if (strong && angleKind !== "value") return `${baseHeadline}, 선택은 지금`;
  return baseHeadline;
}

export function buildTargetedStrategyContent(params: { product: ProductInfoForPrompt; brief: AdBrief; hookType: CreativeStrategy["hookType"]; index?: number; targetIndex?: number }) {
  const index = params.index || 0;
  const analysis = analyzeProductUsp(params.product);
  const angle = targetAwareAngle(analysis, params.hookType, index);
  const selectedTarget = analysis.targetSegments.length ? analysis.targetSegments[(params.targetIndex ?? index) % analysis.targetSegments.length] : undefined;
  const evidence = compactPhrase(angle.signal || analysis.primaryUsp, 24);
  const targetTension = selectedTarget?.tension || angle.tension;
  const tension = compactPhrase(sentenceEnding(targetTension), 24);
  const target = selectedTarget?.label || angle.target || "상품을 비교하는 고객";
  const brand = compactPhrase(params.product.brandName || params.product.advertiserName || params.product.productName, 14);
  const soft = params.brief.creativeIntensity === "brand";
  const strong = params.brief.creativeIntensity === "performance";
  let headline = evidence;

  if (angle.kind === "problem") {
    headline = soft ? `${tension}, 답은 ${evidence}` : strong ? `${tension}? ${evidence}, 이건 바꿔야죠` : `${tension}? 답은 ${evidence}`;
  } else if (angle.kind === "value") {
    headline = strong ? `${evidence}, 이 조건은 봐야죠` : `${evidence}, 살 이유까지 선명하게`;
  } else if (angle.kind === "sensory") {
    headline = strong ? `${evidence}, 감각부터 확실하게` : `${evidence}, 쓰는 순간까지 다르게`;
  } else if (angle.kind === "occasion") {
    headline = strong ? `${evidence}, 이럴 때 놓치면 아쉽죠` : `${evidence}, 필요한 순간에`;
  } else if (angle.kind === "curiosity") {
    headline = `${evidence}, 왜 핵심일까요?`;
  } else if (angle.kind === "proof") {
    headline = strong ? `${evidence}, 말보다 기준으로 보세요` : `${evidence}, 고르는 근거가 됩니다`;
  } else {
    headline = strong ? `${evidence}, 이 차이는 못 넘기죠` : `${evidence}, 차이는 여기서 보입니다`;
  }

  headline = objectiveHeadline({
    objective: params.brief.adObjective,
    angleKind: angle.kind,
    evidence,
    tension,
    brand,
    strong,
    baseHeadline: headline,
  });

  const audience = objectiveAudience(params.brief.adObjective, target);
  const profile = getAdObjectiveProfile(params.brief.adObjective);
  const appealPrefix = params.brief.adObjective === "purchase" ? "구매 결정 근거" : params.brief.adObjective === "signup" ? "처음 설명할 차이" : params.brief.adObjective === "awareness" ? "대표 기억점" : "다시 환기할 이유";

  return {
    headline: compactPhrase(headline, 38),
    appeal: `${appealPrefix}: ${evidence}`,
    audience,
    targetTension,
    evidence,
    hookFormula: angle.formula,
    angleKind: angle.kind,
    objectiveFocus: profile.primaryTask,
  };
}

export function buildTargetedCopyVariants(params: { product: ProductInfoForPrompt; brief: AdBrief; strategy?: CreativeStrategy | null }): Record<"short" | "medium" | "long", GeneratedAdCopyVariant> {
  const analysis = analyzeProductUsp(params.product);
  const hookType = params.strategy?.hookType || "feature-usp";
  const targeted = buildTargetedStrategyContent({
    product: params.product,
    brief: params.brief,
    hookType,
  });
  const offer = analysis.offerSignals[0] || "";
  const proof = analysis.proofSignals[0] || analysis.featureSignals[1] || analysis.primaryUsp;
  const sensory = analysis.sensorySignals[0] || analysis.featureSignals[2] || analysis.primaryUsp;
  const situation = analysis.situationSignals[0] || targeted.targetTension;
  const price = clean(params.product.price);
  const cta = objectiveCta(params.brief.adObjective, Boolean(offer));
  const brand = compactPhrase(params.product.brandName || params.product.advertiserName || params.product.productName, 14);
  const shortEvidence = compactPhrase(targeted.evidence, 8);
  const mediumEvidence = compactPhrase(targeted.evidence, 13);
  const bodyLead = params.brief.adObjective === "purchase" ? `구매 근거는 ${proof}` : params.brief.adObjective === "signup" ? `첫 선택의 기준은 ${proof}` : params.brief.adObjective === "awareness" ? `${brand} 대표 기준은 ${proof}` : `다시 볼 근거는 ${proof}`;
  const shortHeadline = params.brief.adObjective === "purchase" ? `${shortEvidence}, 고를 이유` : params.brief.adObjective === "signup" ? `처음엔 ${shortEvidence}부터` : params.brief.adObjective === "awareness" ? `${compactPhrase(brand, 6)}, ${compactPhrase(targeted.evidence, 6)}` : `${shortEvidence}, 다시 볼 이유`;
  const mediumHeadline = params.brief.adObjective === "purchase" ? `${mediumEvidence}, 지금 고를 이유` : params.brief.adObjective === "signup" ? `처음이라면 ${mediumEvidence}부터` : params.brief.adObjective === "awareness" ? `${compactPhrase(brand, 8)}의 기억점 ${mediumEvidence}` : `${mediumEvidence}, 다시 볼 이유`;
  const longHeadline = params.brief.adObjective === "purchase" ? `${targeted.targetTension}? 결정 근거는 ${targeted.evidence}` : params.brief.adObjective === "signup" ? `${targeted.targetTension}? ${targeted.evidence}부터 비교하세요` : params.brief.adObjective === "awareness" ? `${brand}의 한 가지 기준, ${targeted.evidence}` : `다시 볼 이유가 필요하다면, ${targeted.evidence}`;

  return {
    short: {
      headline: compactPhrase(shortHeadline, 14),
      bodyCopy: compactPhrase(bodyLead, 18),
      highlightCopy: compactPhrase(offer || sensory, 12),
      bottomBarCopy: compactPhrase(situation, 18),
      cta: compactPhrase(cta, 6),
      price,
    },
    medium: {
      headline: compactPhrase(mediumHeadline, 22),
      bodyCopy: compactPhrase(`${bodyLead}. 상세페이지에서 확인해보세요.`, 28),
      highlightCopy: compactPhrase(offer || sensory, 18),
      bottomBarCopy: compactPhrase(`${targeted.audience}에게 추천`, 24),
      cta: compactPhrase(cta, 8),
      price,
    },
    long: {
      headline: compactPhrase(longHeadline, 34),
      bodyCopy: compactPhrase(`${bodyLead}. 또 다른 차이: ${sensory}`, 42),
      highlightCopy: compactPhrase(offer || analysis.featureSignals[2] || sensory, 28),
      bottomBarCopy: compactPhrase(`${targeted.audience}의 선택 기준`, 36),
      cta: compactPhrase(offer ? "구매 조건 확인하기" : "상품 정보 확인하기", 10),
      price,
    },
  };
}

export function buildUspFirstFallbackCopy(product: ProductInfoForPrompt) {
  const analysis = analyzeProductUsp(product);
  const productName = clean(product.productName) || "상품";
  const primary = compactPhrase(analysis.primaryUsp, 28);
  const second = compactPhrase(analysis.uspSignals[1] || productName, 36);
  const offer = analysis.offerSignals[0] || "";
  const productNameTokens = productName.match(/[0-9a-z가-힣]+/gi)?.filter((token) => token.length >= 2 && !genericHookTokens.has(token)) || [];
  const primaryContainsProductIdentity = productNameTokens.some((token) => primary.includes(token));

  return {
    headline: primary,
    bodyCopy: second === primary ? `${productName}의 핵심을 확인해보세요.` : second,
    highlightCopy: offer || compactPhrase(analysis.uspSignals[1] || primary, 18),
    bottomBarCopy: compactPhrase(analysis.situationSignals[0] || analysis.uspSignals[2] || primary, 34),
    cta: offer ? "구매 조건 보기" : "상품 정보 보기",
    price: clean(product.price),
    variants: {
      short: {
        headline: compactPhrase(analysis.uspSignals[0] || productName, 14),
        bodyCopy: compactPhrase(analysis.uspSignals[1] || primary, 18),
        highlightCopy: compactPhrase(offer || analysis.uspSignals[2] || primary, 12),
        bottomBarCopy: compactPhrase(analysis.situationSignals[0] || primary, 18),
        cta: offer ? "조건 보기" : "정보 보기",
        price: clean(product.price),
      },
      medium: {
        headline: compactPhrase(analysis.uspSignals[1] || primary, 22),
        bodyCopy: compactPhrase(analysis.uspSignals[0] || second, 28),
        highlightCopy: compactPhrase(offer || analysis.uspSignals[2] || primary, 18),
        bottomBarCopy: compactPhrase(analysis.situationSignals[0] || analysis.uspSignals[3] || primary, 24),
        cta: offer ? "구매 조건 보기" : "상품 정보 보기",
        price: clean(product.price),
      },
      long: {
        headline: compactPhrase(primaryContainsProductIdentity ? analysis.uspSignals[0] || primary : `${productName}, ${analysis.uspSignals[0] || primary}`, 34),
        bodyCopy: compactPhrase(analysis.uspSignals[1] || analysis.uspSignals[0] || productName, 42),
        highlightCopy: compactPhrase(offer || analysis.uspSignals[2] || primary, 28),
        bottomBarCopy: compactPhrase(analysis.situationSignals[0] || analysis.uspSignals[3] || primary, 36),
        cta: offer ? "구매 조건 확인하기" : "상품 정보 확인하기",
        price: clean(product.price),
      },
    },
  };
}

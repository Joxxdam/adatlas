import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import type { ImageCreativePremise, ProductTruth, ReferenceSceneAdaptation, ReferenceSceneSubjectMode } from "./types";

type SceneDraft = Partial<Pick<ReferenceSceneAdaptation, "expressionPrinciple" | "subjectMode" | "subjectRole" | "action" | "setting">>;

export function referenceContainsPerson(reference: Pick<NativeAdReference, "photographyType" | "compositionType" | "layoutFamily"> | undefined) {
  return reference?.photographyType === "human-model" || reference?.compositionType === "human-use" || reference?.layoutFamily === "human-use";
}

function productIdentity(truth: ProductTruth) {
  return String(truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName || "현재 상품").trim();
}

function verifiedMotifs(truth: ProductTruth, premise?: ImageCreativePremise) {
  const selected = new Set(premise?.supportingFactIds || []);
  const values = [
    productIdentity(truth),
    ...truth.normalized.ingredients,
    ...truth.facts
      .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
      .filter((fact) => selected.has(fact.id) || ["ingredient", "identity", "composition", "usage"].includes(fact.evidenceType || ""))
      .map((fact) => fact.value),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return values.filter((value, index) => values.indexOf(value) === index).slice(0, 8);
}

function fallbackAction(subjectMode: ReferenceSceneSubjectMode, premise: ImageCreativePremise | undefined, copy: string) {
  if (subjectMode === "none") return "현재 상품과 검증된 소품만으로 확정 문구의 핵심 의미를 보여준다";
  if (/선물|고르|선택|비교|고민/u.test(`${copy} ${premise?.situation || ""}`)) {
    return subjectMode === "product-character"
      ? "상품 관련 캐릭터가 선택·발견의 반응을 시각적으로 보여준다"
      : "새 성인이 상품을 비교하거나 선물로 고르는 결정을 자연스럽게 보여준다";
  }
  return subjectMode === "product-character"
    ? "상품 관련 캐릭터가 확정 문구의 감탄·질문·반전을 연기한다"
    : "새 성인이 확정 문구의 상황에 맞게 상품을 발견·확인·선택한다";
}

export function buildReferenceSceneAdaptation(input: {
  truth: ProductTruth;
  reference: NativeAdReference;
  premise?: ImageCreativePremise;
  copy?: string;
  mechanism?: string;
  draft?: SceneDraft;
}): ReferenceSceneAdaptation {
  const sourceHasPerson = referenceContainsPerson(input.reference);
  const allowedModes: ReferenceSceneSubjectMode[] = ["none", "new-adult", "product-character"];
  const requestedMode = input.draft?.subjectMode;
  const subjectMode = requestedMode && allowedModes.includes(requestedMode) ? requestedMode : sourceHasPerson ? "new-adult" : "none";
  const copy = String(input.copy || "").trim();
  return {
    expressionPrinciple: String(input.draft?.expressionPrinciple || input.mechanism || "레퍼런스의 질문·감탄·문제해결 흐름을 현재 상품으로 재구성").trim(),
    subjectMode,
    subjectRole: String(input.draft?.subjectRole || (subjectMode === "new-adult" ? input.premise?.character || "현재 상품을 고르는 새 가상 성인" : subjectMode === "product-character" ? "현재 상품 또는 검증된 구성요소를 의인화한 캐릭터" : "인물 없이 현재 상품이 주인공")).trim(),
    action: String(input.draft?.action || fallbackAction(subjectMode, input.premise, copy)).trim(),
    setting: String(input.draft?.setting || (sourceHasPerson ? "원본 인물과 원본 장소를 제거하고 확정 문구에 맞는 하나의 새 통합 장면으로 재구성" : "호환 배경은 유지하고 원본 상품과 충돌 소품만 같은 영역에서 교체")).trim(),
    preserveElements: ["레퍼런스의 거시 구도", "문구 영역과 읽기 순서", "시각 위계", "색 대비와 CTA 위치"],
    replaceElements: [
      "원본 상품과 원본 광고주 식별 요소",
      "현재 상품과 충돌하는 용기·소품·재료·행동",
      ...(sourceHasPerson ? [subjectMode === "new-adult" ? "원본 인물·정체성·포즈·장소를 새 성인 장면으로 교체" : subjectMode === "product-character" ? "원본 인물·장소를 상품 관련 캐릭터 장면으로 교체" : "원본 인물·장소를 제거하고 상품 중심 장면으로 재구성"] : []),
    ],
    verifiedMotifs: verifiedMotifs(input.truth, input.premise),
  };
}

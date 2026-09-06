import "server-only";

import { selectMasterCreativeDirection } from "./masterDesign";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles";
import { blueprintForReference } from "./referenceCopyProfiles.server";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import type { AdBrief } from "../mvp/types";
import type { CreativePlan, HookPlan, ProductTruth, ScenePlan } from "./types";
import { NATIVE_CREATIVE_VERSION } from "./nativeCreativeVersion";

/**
 * 기본 Codex 제작은 문구·장면을 사전 기획하지 않습니다. 아래 객체는 기존
 * GenerationJob 저장 형식을 유지하기 위한 최소 메타데이터일 뿐이며, 실제
 * 이미지에는 사용자가 확인한 프롬프트와 세 첨부만 전달됩니다.
 */
export function buildDefaultCodexGenerationPlan(input: {
  truth: ProductTruth;
  references: NativeAdReference[];
  logoPath?: string;
  adBrief?: AdBrief;
}) {
  const brandProfile = withRequestedLogo(matchBrandProfile(input.truth.product), input.logoPath);
  const categoryProfile = matchCategoryProfile(input.truth.product);
  const hookPlans: HookPlan[] = input.references.map((reference, index) => {
    const order = index + 1;
    const code = `H${String(order).padStart(2, "0")}`;
    const blueprintId = blueprintForReference(reference);
    return {
      id: `default-codex-${code}-${reference.id}`,
      blueprintId,
      hookType: "reference-guided-codex",
      title: `소재 ${String(order).padStart(2, "0")}`,
      headline: input.truth.normalized?.cleanProductName || input.truth.product.productName,
      body: "",
      proof: "",
      offer: "",
      cta: "",
      audience: input.truth.product.targetCustomer || "상품 고객",
      sceneIntent: "선택 레퍼런스와 사용자 프롬프트를 Codex에 직접 전달",
      factIds: [],
      numericTokens: [],
      hookCode: code,
      hypothesis: `선택 레퍼런스 ${reference.id} 기반 광고`,
      confidence: "high",
      mainMessage: input.truth.normalized?.cleanProductName || input.truth.product.productName,
      selectionReason: reference.selectionReason,
      visualDirection: reference.layoutFamily,
      validationStatus: "valid",
      generationSource: "fallback",
    };
  });
  const masterDesign = selectMasterCreativeDirection({
    truth: input.truth,
    brand: brandProfile,
    category: categoryProfile,
    preserveMasterDesignId: `default-codex-${hookPlans[0]?.blueprintId || "product-hero-lifestyle"}`,
  });
  const creativePlan: CreativePlan = {
    id: `default-codex-plan-${Date.now().toString(36)}`,
    productTruth: input.truth,
    brandProfile,
    categoryProfile,
    hookPlans,
    blueprintIds: hookPlans.map((plan) => plan.blueprintId),
    masterDesign,
    testCode: "T01",
    copyGeneration: { provider: "fallback", warnings: [] },
    adBrief: input.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: NATIVE_CREATIVE_VERSION,
  };
  const scenes: ScenePlan[] = input.references.map((reference, index) => ({
    id: `default-codex-scene-${index + 1}-${reference.id}`,
    blueprintId: hookPlans[index].blueprintId,
    sceneAsset: {
      id: reference.id,
      file: reference.path,
      sourceType: "library",
      assetType: "curated-ad-reference",
      scene: reference.layoutFamily,
      category: reference.categoryGroup,
      includesPerson: reference.photographyType === "human-model",
      textSafeArea: "reference-defined",
      productPosition: "reference-defined",
    },
    promptVersion: NATIVE_CREATIVE_VERSION,
    provider: "library",
    generated: false,
    paidGenerationAllowed: false,
    generationMode: "reference-guided-full-scene",
    reason: reference.selectionReason,
  }));
  return { creativePlan, scenes };
}

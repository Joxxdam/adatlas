import "server-only";

import { Codex } from "@openai/codex-sdk";
import { resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { selectMasterCreativeDirection } from "./masterDesign";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles";
import { extractNumericTokens, validateCopyAgainstTruth } from "./productTruth";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import { applyReferenceCopyGroupRules } from "./referenceCopyDiversity";
import { consumerFacingFactHint, findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness";
import { isAmbiguousMerchantCredentialCreativeSignal, isIncompleteOcrCopyFragment, isMalformedProductSignal, isMerchantCredentialCreativeSignal, isNonDomesticOriginCreativeSignal, isProhibitedAdCopySignal, isShippingCreativeSignal } from "./productSignalHygiene";
import { CURRENT_REFERENCE_COPY_POLICY_VERSION } from "./jobRunnerPolicy";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";
import { isApprovedReferenceNativeCopy, normalizeReferenceRawLines, type ReferenceTextRegion } from "./referenceLibraryManagement";
import { findProductCopySemanticErrors, resolveProductCopyDomain } from "./productCopySemantics";
import { buildImageCreativePremiseSeed, buildImageCreativePremiseSeeds, findImageCreativePremiseCopyErrors, findImageCreativePremiseErrors, IMAGE_CREATIVE_PREMISE_POLICY_VERSION, normalizeImageCreativePremise } from "./imageCreativePremise.ts";
import { loadCopyGuideForProduct, type LoadedCopyGuide } from "../mvp/copyGuideLoader";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ImageCreativePremise, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

import {
  REFERENCE_ADAPTED_PLANNER_VERSION,
  REFERENCE_COPY_PROFILE_VERSION,
  blueprintForReference,
  fallbackProfile,
  referenceHash,
} from "./referenceCopyProfiles.server";
import {
  applyMerchantCredentialGroupRule,
  createEvidenceSafeMinimalPlan,
  ensureRenderableReferencePlans,
  normalizePlan,
} from "./referenceCopyPlanningCore";
import { hydrateLeanPlannerPayload, planningPrompt, reviewPlans, runPlanner, selectPlannerCandidates } from "./referenceCopyPlannerRuntime.server";
import { normalizeReferenceCopyPlanMetadata } from "./referenceCopyCandidates.ts";
import { alignPremiseSeedsToEvidenceAssignments, buildReferenceCopyEvidenceAssignments, referenceRhetoricalMechanism } from "./referenceCopyAngles.ts";

export { REFERENCE_ADAPTED_PLANNER_VERSION, REFERENCE_COPY_PROFILE_VERSION };
export {
  createBestEffortReferenceCopyPlan,
  createTruthFallbackReferenceCopyPlan,
  hasExecutableReferenceCopyContract,
  hasPublishableReferenceCopyContract,
} from "./referenceCopyPlanningCore";
export { prepareReferenceAdaptedCopyScaffold, prewarmReferenceCopyProfiles } from "./referenceCopyPlannerRuntime.server";

export async function planReferenceAdaptedCopies(input: { truth: ProductTruth; references: NativeAdReference[] }) {
  const copyGuide = await loadCopyGuideForProduct({
    brandName: input.truth.product.brandName,
    advertiserName: input.truth.product.advertiserName,
    productUrl: input.truth.product.landingUrl,
    category: input.truth.product.category,
    productName: input.truth.product.productName,
    copyGuideId: input.truth.product.copyGuideId,
  });
  const profiles = await Promise.all(input.references.map(async (reference) => {
    const profile = fallbackProfile(reference, await referenceHash(reference));
    const raw = reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "";
    return {
      ...profile,
      tone: /ㅋㅋ|;;|\.\.|\?\!|\!\?/.test(raw) ? "레퍼런스 원문 구어체" : "레퍼런스 원문 말투",
      rhetoricalDevice: referenceRhetoricalMechanism(reference),
      punctuationRhythm: raw.match(/[?!;.~ㅋ]+/gu)?.join(" ") || "원문 문장부호 최소 유지",
      headlineLineBudget: Math.max(1, Math.min(4, reference.nativeCopy?.textRegions.find((region) => region.role === "headline")?.lines.length || 2)),
      supportLineBudget: Math.max(0, Math.min(5, reference.nativeCopy?.rawLines.length || 2)),
      prohibitedLiteralPhrases: [],
      analysisSource: reference.nativeCopy?.extractionSource === "codex-local" ? "codex-local" as const : "safe-minimal" as const,
    };
  }));
  const evidenceAssignments = buildReferenceCopyEvidenceAssignments(input.truth, input.references);
  const readyEntries = input.references
    .map((reference, index) => ({ reference, profile: profiles[index], index }))
    .filter(({ reference }) => isApprovedReferenceNativeCopy(reference.nativeCopy));
  const premiseSeeds = alignPremiseSeedsToEvidenceAssignments(input.truth, buildImageCreativePremiseSeeds(input.truth, input.references), evidenceAssignments);
  const fallbackPlans = input.references.map((reference, index) => createEvidenceSafeMinimalPlan(input.truth, reference, profiles[index], index, premiseSeeds[index], evidenceAssignments[index]));
  if (!readyEntries.length) {
    return {
      profiles,
      plans: ensureRenderableReferencePlans({ truth: input.truth, references: input.references, profiles, plans: fallbackPlans, premiseSeeds, evidenceAssignments }),
      provider: "fallback" as const,
      warnings: ["저장·자동 검증된 레퍼런스 OCR 원문이 없어 레퍼런스 구성 태그와 상품 사실로 최선 문구를 만들고 제작을 계속합니다. 제작 중 즉석 OCR은 실행하지 않았습니다."],
    };
  }
  const readyReferences = readyEntries.map(({ reference }) => reference);
  const readyProfiles = readyEntries.map(({ profile }) => profile);
  const readyPremiseSeeds = readyEntries.map(({ index }) => premiseSeeds[index]);
  try {
    const planningWarnings: string[] = [];
    const readyEvidenceAssignments = readyEntries.map(({ index }) => evidenceAssignments[index]);
    const leanResponse = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, premiseSeeds: readyPremiseSeeds, evidenceAssignments: readyEvidenceAssignments, missingProfileIds: [], copyGuide }));
    let response = hydrateLeanPlannerPayload({ payload: leanResponse, truth: input.truth, references: readyReferences, profiles: readyProfiles, premiseSeeds: readyPremiseSeeds, evidenceAssignments: readyEvidenceAssignments });
    response = await selectPlannerCandidates({ truth: input.truth, references: readyReferences, evidenceAssignments: readyEvidenceAssignments, payload: response });
    let readyPlans = readyEntries.map(({ reference, profile, index }, readyIndex) => normalizePlan(response.plans.find((plan) => plan.referenceId === reference.id), input.truth, reference, profile, index, readyPremiseSeeds[readyIndex], "codex-local", readyEvidenceAssignments[readyIndex]));
    readyPlans = reviewPlans({ truth: input.truth, profiles: readyProfiles, plans: readyPlans, copyGuide });
    // 묶음 중복·가격 반복 오류도 1회 보정 배치에 포함한다. 과거에는 보정이
    // 끝난 뒤 처음 발견되어 고칠 기회 없이 규칙 문구로 교체되던 문제를 막는다.
    readyPlans = applyMerchantCredentialGroupRule(applyReferenceCopyGroupRules(readyPlans, input.truth));
    const failed = readyPlans.filter((plan) => plan.validationStatus === "invalid");
    if (failed.length) {
      try {
        const leanRepair = await runPlanner(planningPrompt({ truth: input.truth, references: readyReferences, profiles: readyProfiles, premiseSeeds: readyPremiseSeeds, evidenceAssignments: readyEvidenceAssignments, missingProfileIds: [], copyGuide, repairPlans: failed }));
        let repaired = hydrateLeanPlannerPayload({ payload: leanRepair, truth: input.truth, references: readyReferences, profiles: readyProfiles, premiseSeeds: readyPremiseSeeds, evidenceAssignments: readyEvidenceAssignments });
        repaired = await selectPlannerCandidates({ truth: input.truth, references: readyReferences, evidenceAssignments: readyEvidenceAssignments, payload: repaired });
        readyPlans = readyPlans.map((plan, readyIndex) => {
          const entry = readyEntries[readyIndex];
          return plan.validationStatus === "invalid" ? normalizePlan(repaired.plans.find((candidate) => candidate.referenceId === plan.referenceId), input.truth, entry.reference, entry.profile, entry.index, readyPremiseSeeds[readyIndex], "repaired-codex-local", readyEvidenceAssignments[readyIndex]) : plan;
        });
        const repairedReferenceIds = new Set(failed.map((plan) => plan.referenceId));
        const repairedPlans = readyPlans.filter((plan) => repairedReferenceIds.has(plan.referenceId));
        const reviewedRepairs = reviewPlans({ truth: input.truth, profiles: readyProfiles.filter((profile) => repairedReferenceIds.has(profile.referenceId)), plans: repairedPlans, copyGuide });
        const reviewedByReference = new Map(reviewedRepairs.map((plan) => [plan.referenceId, plan]));
        readyPlans = readyPlans.map((plan) => reviewedByReference.get(plan.referenceId) || plan);
        readyPlans = applyMerchantCredentialGroupRule(applyReferenceCopyGroupRules(readyPlans, input.truth));
      } catch (error) {
        const message = error instanceof Error ? error.message : "문구 1회 보정에 실패했습니다.";
        readyPlans = readyPlans.map((plan) => plan.validationStatus === "invalid" ? { ...plan, validationErrors: [...plan.validationErrors, message], repairCount: 1 } : plan);
      }
    }
    const plannedByReference = new Map(readyPlans.map((plan) => [plan.referenceId, plan]));
    let plans = input.references.map((reference, index) => plannedByReference.get(reference.id) || fallbackPlans[index]);
    plans = applyMerchantCredentialGroupRule(applyReferenceCopyGroupRules(plans, input.truth));
    // AI 보정 이후에도 publishable 계약에 미달한 항목은 검증된 결정적
    // ProductTruth fallback으로 교체한다. 검증되지 않은 best-effort는 실행하지 않는다.
    plans = ensureRenderableReferencePlans({ truth: input.truth, references: input.references, profiles, plans, premiseSeeds, evidenceAssignments });
    plans = applyMerchantCredentialGroupRule(applyReferenceCopyGroupRules(plans, input.truth));
    return { profiles, plans, provider: "codex-local" as const, warnings: [...planningWarnings, ...plans.flatMap((plan) => plan.validationErrors)] };
  } catch (error) {
    return {
      profiles,
      plans: ensureRenderableReferencePlans({ truth: input.truth, references: input.references, profiles, plans: fallbackPlans, premiseSeeds, evidenceAssignments }),
      provider: "fallback" as const,
      warnings: [error instanceof Error ? error.message : "최신 레퍼런스 문구 계획을 준비하지 못해 이미지 생성을 시작하지 않습니다."],
    };
  }
}
export function buildReferenceAdaptedCreativePlan(input: { truth: ProductTruth; references: NativeAdReference[]; copyPlans: ReferenceAdaptedCopyPlan[]; logoPath?: string; adBrief?: AdBrief; testCode?: `T${string}`; provider: "codex-local" | "fallback"; warnings?: string[] }): CreativePlan {
  const brandProfile = withRequestedLogo(matchBrandProfile(input.truth.product), input.logoPath);
  const categoryProfile = matchCategoryProfile(input.truth.product);
  const hookPlans: HookPlan[] = input.copyPlans.map((storedPlan, index) => {
    const plan = normalizeReferenceCopyPlanMetadata(storedPlan);
    const reference = input.references[index];
    const blueprintId = blueprintForReference(reference);
    return {
      id: `material-${plan.resultCode}-${reference.id}`,
      blueprintId,
      hookType: "reference-adapted-material",
      title: `소재 ${String(index + 1).padStart(2, "0")}`,
      headline: plan.headline,
      body: plan.subCopy,
      proof: plan.proof,
      offer: plan.offer,
      cta: plan.cta,
      audience: input.truth.product.targetCustomer || "상품 고객",
      sceneIntent: `선택된 레퍼런스 ${reference.id}의 구도와 문구 구조 안에서 ${plan.creativePremise?.situation || "현재 상품 사용 순간"}을 표현한 상품 교체 소재`,
      factIds: plan.factIds,
      numericTokens: extractNumericTokens([plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].join(" ")),
      hookCode: plan.resultCode,
      hypothesis: `레퍼런스 ${reference.id} 적응 소재`,
      confidence: plan.validationStatus === "valid" ? "high" : "medium",
      mainMessage: plan.headline,
      evidenceSummary: plan.sourceFactValues.join(" · "),
      naturalnessScore: plan.naturalnessScore,
      validationStatus: plan.validationStatus === "invalid" ? "invalid" : plan.validationStatus === "needs-review" ? "fallback" : "valid",
      validationErrors: plan.validationErrors,
      generationSource: plan.generationSource === "validated-fallback" || plan.generationSource === "reference-best-effort" || plan.generationSource === "safe-minimal" ? "fallback" : plan.generationSource === "repaired-codex-local" ? "repaired-ai" : "ai",
      repairCount: plan.repairCount,
      sentenceStyle: plan.sentenceStyle,
      selectionReason: reference.selectionReason,
      visualDirection: reference.layoutFamily,
    };
  });
  const masterDesign = selectMasterCreativeDirection({ truth: input.truth, brand: brandProfile, category: categoryProfile, preserveMasterDesignId: `reference-first-${hookPlans[0]?.blueprintId || "product-hero-lifestyle"}` });
  return {
    id: `reference-plan-${Date.now().toString(36)}`,
    productTruth: input.truth,
    brandProfile,
    categoryProfile,
    hookPlans,
    blueprintIds: hookPlans.map((plan) => plan.blueprintId),
    masterDesign,
    mode: "reference-adapted-materials",
    testCode: input.testCode || "T01",
    copyGeneration: { provider: input.provider, repairAttempts: input.copyPlans.some((plan) => plan.repairCount > 0) ? 1 : 0, warnings: input.warnings || [] },
    adBrief: input.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: REFERENCE_ADAPTED_PLANNER_VERSION,
  };
}

export function buildReferenceScenes(references: NativeAdReference[], copyPlans: ReferenceAdaptedCopyPlan[]): ScenePlan[] {
  return references.map((reference, index) => ({
    id: `scene-${copyPlans[index].resultCode}-${reference.id}`,
    blueprintId: blueprintForReference(reference),
    sceneAsset: { id: reference.id, file: reference.path, sourceType: "library", assetType: "curated-ad-reference", scene: reference.layoutFamily, category: reference.categoryGroup, includesPerson: reference.photographyType === "human-model", textSafeArea: "reference-defined", productPosition: "reference-defined" },
    promptVersion: "reference-first-scene-v1",
    provider: "library",
    generated: false,
    paidGenerationAllowed: false,
    generationMode: "reference-guided-full-scene",
    reason: reference.selectionReason,
  }));
}

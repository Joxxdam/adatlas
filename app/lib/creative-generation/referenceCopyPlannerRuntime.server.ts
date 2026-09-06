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
import type { CreativeBlueprintId, CreativePlan, HookPlan, ImageCreativePremise, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyBlock, ReferenceCopyCandidate, ReferenceCopyEvidenceAssignment, ReferenceCopyProfile, ScenePlan } from "./types";

import {
  CREATIVE_CONTEXT_POLICY,
  NATURALNESS_PASS_SCORE,
  REFERENCE_COPY_PROFILE_VERSION,
  REFERENCE_FIT_PASS_SCORE,
  copyGuidePromptBlock,
  fallbackProfile,
  profileSchema,
  readProfileCache,
  referenceHash,
  sheetClaimPolicy,
  resolvedVendorCopyExamples,
  vendorCopyExamplePromptBlock,
  writeProfileCache,
  type ProfilePayload,
} from "./referenceCopyProfiles.server";
import { leanPlannerSchema, type LeanPlannerPayload, type PlannerPayload } from "./referenceCopyCandidates.ts";
import { alignPremiseSeedsToEvidenceAssignments, assignCreativeAngles, buildReferenceCopyEvidenceAssignments, referenceRhetoricalMechanism } from "./referenceCopyAngles.ts";
import { validateReferenceCopyCandidate } from "./referenceCopyCandidateValidation.ts";
import { selectReferenceCopyCandidate } from "./referenceCopyCandidateSelector.ts";
import { fitReferenceCopyBlocks } from "./referenceCopyTextFit.ts";
import { isReferenceCopyTimeoutError, isRetryableReferenceCopyTransportError } from "./referenceCopyTransport.ts";
import {
  createEvidenceSafeMinimalPlan,
  ensureRenderableReferencePlans,
  factsForPlanning,
  shortProductIdentity,
} from "./referenceCopyPlanningCore";

const DEFAULT_REFERENCE_COPY_TIMEOUT_MS = 60_000;

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; premiseSeeds: ImageCreativePremise[]; evidenceAssignments: ReferenceCopyEvidenceAssignment[]; missingProfileIds: string[]; copyGuide?: LoadedCopyGuide | null; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  const assignedIdeas = assignCreativeAngles(input.truth, input.references);
  const facts = factsForPlanning(input.truth).slice(0, 18);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const repairByReference = new Map((input.repairPlans || []).map((plan) => [plan.referenceId, plan]));
  const contracts = input.references.map((reference, index) => {
    const assignment = input.evidenceAssignments[index];
    const idea = assignedIdeas[index];
    const profile = input.profiles[index];
    const assignedFacts = [assignment?.primaryFactId, ...(assignment?.supportingFactIds || [])]
      .map((id) => factById.get(id || ""))
      .filter(Boolean);
    const adaptableRegions = (reference.nativeCopy?.textRegions || [])
      .filter((region) => region.sourceType !== "source-brand" && region.replacePolicy !== "remove")
      .slice(0, 10);
    const slots = adaptableRegions
      .map((region) => ({
        role: region.role,
        sourceLines: region.lines.slice(0, 4).map((line) => line.slice(0, 80)),
        characterBudget: region.characterBudget,
        emphasis: region.emphasis,
      }))
      .slice(0, 10);
    const rawText = reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "";
    return {
      resultCode: `H${String(index + 1).padStart(2, "0")}`,
      referenceId: reference.id,
      mechanism: referenceRhetoricalMechanism(reference),
      tone: profile?.tone,
      sentenceStyle: profile?.sentenceStyle,
      punctuationRhythm: rawText.match(/[?!;.~ㅋ]+/gu)?.join(" ") || "",
      semanticComparison: referenceRequiresComparisonSemantics(reference),
      slots,
      sourceLinePattern: slots.length ? [] : normalizeReferenceRawLines(reference.nativeCopy?.rawLines || []).slice(0, 10).map((line) => line.slice(0, 80)),
      consumerSituation: idea?.consumerSituation,
      tension: idea?.tension,
      reaction: idea?.reaction,
      primaryFactId: assignment?.primaryFactId,
      assignedFacts,
      repairErrors: repairByReference.get(reference.id)?.validationErrors || [],
      previousCopy: repairByReference.has(reference.id)
        ? [repairByReference.get(reference.id)?.headline, repairByReference.get(reference.id)?.subCopy, repairByReference.get(reference.id)?.proof, repairByReference.get(reference.id)?.offer, repairByReference.get(reference.id)?.cta].filter(Boolean)
        : [],
    };
  }).filter((contract) => !input.repairPlans?.length || repairByReference.has(contract.referenceId));
  return `한국 이미지 광고 문구를 작성한다. 설명·점수·분석 없이 copies JSON만 반환한다.

상품: ${shortProductIdentity(input.truth)}
상품군: ${resolveProductCopyDomain(input.truth.product)}
사용 가능한 사실: ${JSON.stringify(facts)}
금지 브랜드·업체명: ${JSON.stringify([input.truth.product.advertiserName, input.truth.product.brandName, input.truth.normalized.brandName].filter(Boolean))}
추가 상품 제약: ${JSON.stringify(input.truth.productCopyConstraints || [])}

작성 규칙:
- 처음 보는 사람이 1초 안에 이해할 사람 말투의 완결된 광고 문장으로 쓴다.
- 사실을 나열하지 말고 contract의 소비자 상황·긴장·반응에서 primaryFactId의 구매 이유로 연결한다.
- slots.sourceLines와 sourceLinePattern은 저장·승인된 실제 OCR 원문이다. 문장을 복사하지 않고 말투·질문/반전 위치·블록 역할·읽기 순서·판매 강도와 문장부호 리듬만 활용한다.
- headline/support/proof/offer/cta만 작성한다. 필요 없는 필드는 빈 문자열로 둔다. 빈 가격·CTA 슬롯을 다른 문구로 억지로 채우지 않는다.
- 숫자·가격·구성·효능·원산지·인증은 사용 가능한 사실에 있을 때만 정확히 쓴다. 옵션 미확정 상품은 가격·할인·팩 수를 쓰지 않는다.
- 판매자 표기상, 확인된, 검증된, ProductTruth, OCR, 상품 정보 같은 근거 관리 말투와 깨진 한자·따옴표를 쓰지 않는다.
- 사실에 없는 부드러움·효능·후기·순위·전문가 추천·최저가·재고·품절·긴급성을 만들지 않는다.
- 자연스럽게 연결된 계절·시즌·유행·밈·사용 상황이 ProductTruth에 없다는 이유만으로 factualSafety를 감점하거나 오류로 판정하지 않는다. 단, 실제 후기·성과·이벤트처럼 쓰지는 않는다.
- 근거 없는 'SNS 1위'·'오늘만 할인'·'곧 품절'은 금지한다.
- 특별한 선택, 새로운 경험, 직접 느껴보세요, 상품 자세히 보기 같은 범용 문구만으로 채우지 않는다.
- 같은 이미지 안에서 상품명이나 동일 문장을 반복하지 않는다. 48시간 숙성·육즙처럼 중요한 검증 근거는 서로 다른 소재에서 반복해도 된다.
- 업체 가이드는 ${input.copyGuide?.brandName || "미지정"}의 말투 경계만 따르며 예문은 복사하지 않는다.

레퍼런스 분석 계약:
${JSON.stringify(contracts)}

${input.repairPlans?.length ? "repairErrors를 모두 해결한 해당 소재만 다시 반환한다." : "여섯 계약에 대응하는 서로 다른 문구를 정확히 한 개씩 반환한다."}`;
}

function hydrateLeanPlannerPayload(input: {
  payload: LeanPlannerPayload;
  truth: ProductTruth;
  references: NativeAdReference[];
  profiles: ReferenceCopyProfile[];
  premiseSeeds: ImageCreativePremise[];
  evidenceAssignments: ReferenceCopyEvidenceAssignment[];
}): PlannerPayload {
  const assignedIdeas = assignCreativeAngles(input.truth, input.references);
  const knownFactIds = new Set(input.truth.facts.map((fact) => fact.id));
  const plans = input.references.flatMap((reference, index) => {
    const copy = input.payload.copies.find((candidate) => candidate.referenceId === reference.id);
    if (!copy) return [];
    const assignment = input.evidenceAssignments[index];
    const factIds = [assignment?.primaryFactId, ...(assignment?.supportingFactIds || [])]
      .filter((id): id is string => Boolean(id && knownFactIds.has(id)));
    const rawCopyBlocks: ReferenceCopyBlock[] = [
      { role: "headline", text: copy.headline.trim(), coreFactIds: factIds },
      { role: "support", text: copy.support.trim(), coreFactIds: factIds },
      { role: "proof", text: copy.proof.trim(), coreFactIds: factIds },
      { role: "offer", text: copy.offer.trim(), coreFactIds: factIds },
      { role: "cta", text: copy.cta.trim(), coreFactIds: [] },
    ];
    const copyBlocks = rawCopyBlocks.filter((block) => block.text);
    const fullCopy = copyBlocks.map((block) => block.text).join("\n");
    const idea = assignedIdeas[index];
    const candidateId = `lean-${copy.resultCode || `H${String(index + 1).padStart(2, "0")}`}`;
    const candidate: ReferenceCopyCandidate = {
      id: candidateId,
      creativeAngle: idea.creativeAngle,
      candidateMode: "reference-faithful" as const,
      claimModes: ["subjective-reaction", "objective-fact"],
      coreFactIds: factIds,
      fullCopy,
      copyBlocks,
      copyRiskFlags: [],
      copyReviewRequired: false,
      safeAlternative: "",
      referenceFitReason: `${referenceRhetoricalMechanism(reference)} 수사와 저장된 문구 블록 순서를 사용했습니다.`,
      productDifferenceReason: assignment?.primaryFactId ? `서버가 배정한 상품 근거 ${assignment.primaryFactId}를 중심 구매 이유로 사용했습니다.` : "현재 상품명을 중심 구매 이유로 사용했습니다.",
      noveltyReason: "레퍼런스 원문을 복사하지 않고 현재 상품과 소비자 상황으로 새로 작성했습니다.",
    };
    const profile = input.profiles[index];
    return [{
      resultCode: `H${String(index + 1).padStart(2, "0")}`,
      referenceId: reference.id,
      creativePremise: input.premiseSeeds[index],
      observedSourceLines: reference.nativeCopy?.rawLines || [],
      adaptedLines: [],
      headline: copy.headline.trim(),
      subCopy: copy.support.trim(),
      proof: copy.proof.trim(),
      offer: copy.offer.trim(),
      cta: copy.cta.trim(),
      factIds,
      tone: profile?.tone || "레퍼런스 원문 말투",
      sentenceStyle: profile?.sentenceStyle || "declaration",
      naturalnessScore: 92,
      referenceFitScore: 92,
      factualSafetyScore: 100,
      validationErrors: [],
      creativeAngle: idea.creativeAngle,
      hookIdea: idea,
      candidateMode: candidate.candidateMode,
      claimModes: [...candidate.claimModes],
      copyRiskFlags: [],
      copyReviewRequired: false,
      fullCopy,
      copyBlocks,
      candidates: [candidate],
      selectedCandidateId: candidateId,
    }];
  });
  return { profiles: [], hookIdeas: [], plans };
}

function profilePrompt(references: NativeAdReference[]) {
  return `광고 레퍼런스 이미지의 문구 구조만 분석한다. 상품 전략이나 새 문구는 생성하지 않는다. 각 imagePath를 확인해 headline/support/proof/offer/CTA 역할, 줄 수와 글자 수 예산, 말투, 문장형, 수치 강조, 문장부호 리듬을 기록한다. 원문의 핵심 리터럴 문구는 prohibitedLiteralPhrases에 기록한다. JSON 스키마만 반환한다.\n${JSON.stringify(references.map((reference) => ({ referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity })), null, 2)}`;
}

function criticPrompt(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  return `아래 한국 이미지 광고 문구를 한 번에 독립 검수한다. 문구를 새로 쓰지 말고 점수와 오류만 반환한다.
ProductTruth는 객관적 사실의 상한선이다. 가격·수치·등급·원산지·효능·인증·후기·순위·재고·긴급성은 연결된 근거와 정확히 일치해야 한다. 반면 숫자나 공식 성과를 만들지 않는 subjective-reaction, lifestyle-scenario, obvious-puffery는 사실 문장으로 오인하지 않는다. 가족 식사·사용 순간·감탄·밈·주관적 만족은 자연스러운 창작 맥락이다. 실제 경력·고객 증언·내부정보처럼 들리는 dramatized-persona가 자동 제작 최종안에 남으면 factualSafety 실패다.
${CREATIVE_CONTEXT_POLICY}
${sheetClaimPolicy(input.truth)}
최종 상품 카테고리: ${resolveProductCopyDomain(input.truth.product)}. 식품 섭취·조리 표현과 화장품 샤워·피부 표현이 뒤섞이면 치명 오류다.
레퍼런스는 문장 사전이 아니라 수사 메커니즘이다. referenceRawLines와 단어가 달라도 질문→대답, 문제→해결, 비교→결론, 경험→반응, 감탄→구매 이유 및 블록 역할·읽기 순서·판매 강도가 살아 있으면 referenceFit을 높게 평가한다. 레퍼런스 문장을 명사·조사만 바꿨거나 상품 스펙 목록으로 바꿨으면 낮게 평가한다.
각 plan의 evidenceAssignment는 서버가 고정한 계약이다. primaryFactId가 실제 문구의 중심 구매 이유로 드러나야 하며 sensoryLed=false인 오리지널소스 소재가 향·향기·기분 전환으로 수렴하면 referenceFit과 naturalness를 낮추고 오류를 남긴다.
자연스러움은 1초 이해, 사람 말투, 완결된 주어·서술어·조사, 구체 구매 이유, 전체 문장을 먼저 쓴 뒤의 자연스러운 줄바꿈을 본다. 범용 AI 문구, 미완성 연결어, 쉼표 끝, 단어 절단, 상품명·가격·중량 반복은 실패다. source-brand/remove 슬롯의 빈 targetText는 정상이다.
사용자가 제공한 예문이나 레퍼런스 문장과 실질적으로 같은 표현을 새 상품명으로 바꾼 후보는 novelty 실패다. 업체 가이드 예문은 표현 방식과 근거 경계를 판단하는 자료일 뿐 복사 대상이 아니다.
업체별 문구 품질 기준:
${copyGuidePromptBlock(input.copyGuide)}
후기 카드의 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터는 금지한다. 브랜드명·업체명·판매자명과 업체 업력·순위·수상·브랜드 파워는 직접 상품 근거가 아니면 금지한다.
valid는 naturalness ${NATURALNESS_PASS_SCORE}, referenceFit ${REFERENCE_FIT_PASS_SCORE}, factualSafety 90 이상이고 치명 오류가 없을 때만 true다.
금지 브랜드·업체명: ${JSON.stringify([input.truth.product.advertiserName, input.truth.product.brandName, input.truth.normalized.brandName].filter(Boolean))}
ProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}
Plans: ${JSON.stringify(input.plans)}
JSON 스키마만 반환한다.`;
}

function selectorPrompt(input: { truth: ProductTruth; payload: PlannerPayload; references: NativeAdReference[]; evidenceAssignments: ReferenceCopyEvidenceAssignment[] }) {
  const providedExamples = resolvedVendorCopyExamples(input.truth).flatMap((example) => [example.headline, example.support]).filter(Boolean);
  const eligible = input.payload.plans.map((plan) => {
    const reference = input.references.find((item) => item.id === plan.referenceId);
    const evidenceAssignment = input.evidenceAssignments.find((item) => item.referenceId === plan.referenceId);
    return {
      referenceId: plan.referenceId,
      referenceMechanism: plan.hookIdea?.referenceMechanism,
      evidenceAssignment,
      candidates: plan.candidates
        .map((candidate) => validateReferenceCopyCandidate({ candidate, truth: input.truth, evidenceAssignment, comparisonCopies: [...(reference?.nativeCopy?.rawLines || []), ...providedExamples] }))
        .filter((result) => result.eligible)
        .map((result) => ({
          id: result.candidate.id,
          creativeAngle: result.candidate.creativeAngle,
          candidateMode: result.candidate.candidateMode,
          fullCopy: result.candidate.fullCopy,
          coreFactIds: result.candidate.coreFactIds,
          referenceFitReason: result.candidate.referenceFitReason,
          productDifferenceReason: result.candidate.productDifferenceReason,
          noveltyReason: result.candidate.noveltyReason,
          copyReviewRequired: result.candidate.copyReviewRequired,
          deterministicPenalties: result.penalties,
        })),
    };
  }).filter((entry) => entry.candidates.length);
  return `후보 selector다. 문구를 새로 쓰거나 수정하지 말고 제공된 candidate id만 평가한다.
결정적 factualSafety 검사를 통과한 후보만 제공됐다. 사실 안전은 점수로 상쇄하지 않는다.
각 후보를 stopPower 20, productDifference 20, humanVoice 20, concretePurchaseReason 15, referenceFit 20, novelty 5 관점의 0~100 점수로 평가한다. 범용 설명문, 문구 템플릿 복제, 같은 상품의 다른 후보와 의미 중복은 낮게 평가한다. 배정된 primaryFactId를 중심 근거로 쓰지 않았거나 OCR의 감정 강도·질문/반전 위치·말하는 대상을 잃은 후보는 referenceFit을 50 미만으로 평가한다. referenceId별 모든 candidate를 반환하고 가장 좋은 순서가 드러나게 점수를 준다. 선택 이유와 탈락 이유만 반환한다.
ProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}
Candidates: ${JSON.stringify(eligible)}
JSON 스키마만 반환한다.`;
}

async function runCodexJson<T>(prompt: string, outputSchema: object, retryCount = 0) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (!(await codexLocalAuthenticated({ force: true }))) throw new Error("로컬 Codex 로그인이 없습니다.");
      // 전송 오류 뒤에는 SDK/thread 인스턴스를 재사용하지 않는다. 특히 로컬 로그인
      // backend의 일시적 404는 새 thread에서 정상화되는 경우가 있다.
      const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
      const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "low" });
      const response = await thread.run(prompt, { outputSchema, signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_COPY_TIMEOUT_MS, DEFAULT_REFERENCE_COPY_TIMEOUT_MS, 30_000)) });
      return JSON.parse(response.finalResponse) as T;
    } catch (error) {
      lastError = error;
      // timeout은 같은 대형 배치를 즉시 한 번 더 실행하지 않고 검증된 fallback
      // 또는 작업 단위 backoff로 넘긴다. 404/5xx/연결 끊김만 새 thread로 즉시 재시도한다.
      if (attempt >= retryCount || !isRetryableReferenceCopyTransportError(error) || isReferenceCopyTimeoutError(error)) throw error;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000 * (attempt + 1));
        timer.unref?.();
      });
    }
  }
  throw lastError;
}

async function runPlanner(prompt: string) {
  // 생성 중 로컬 Codex 호출은 최초 배치 1회와 실패 항목 보정 1회만 허용한다.
  // 전송 실패도 같은 대형 배치를 자동 반복하지 않고 안전 최소 문구로 넘긴다.
  return runCodexJson<LeanPlannerPayload>(prompt, leanPlannerSchema);
}

async function selectPlannerCandidates(input: { truth: ProductTruth; references: NativeAdReference[]; evidenceAssignments: ReferenceCopyEvidenceAssignment[]; payload: PlannerPayload }) {
  // 별도 AI selector를 열지 않는다. 사실·중복·카테고리·문장 완결성 검증을
  // 통과한 후보만 고정 가중치 휴리스틱으로 비교한다.
  const providedExamples = resolvedVendorCopyExamples(input.truth).flatMap((example) => [example.headline, example.support]).filter(Boolean);
  const selectedSiblingCopies: string[] = [];
  const plans = input.payload.plans.map((plan) => {
    const reference = input.references.find((candidate) => candidate.id === plan.referenceId);
    if (!reference) return plan;
    const evidenceAssignment = input.evidenceAssignments.find((candidate) => candidate.referenceId === plan.referenceId);
    const selection = selectReferenceCopyCandidate({
      candidates: plan.candidates,
      truth: input.truth,
      evidenceAssignment,
      comparisonCopies: [...(reference.nativeCopy?.rawLines || []), ...providedExamples],
      siblingCopies: selectedSiblingCopies,
    });
    const selected = selection.selected;
    if (!selected) return { ...plan, validationErrors: [...new Set([...plan.validationErrors, "결정적 검증을 통과한 문구 후보가 없습니다."])] };
    selectedSiblingCopies.push(selected.fullCopy);
    const rankedByOriginalId = new Map(selection.ranked.map((candidate) => [candidate.id.replace(/-safe$/, ""), candidate]));
    const storedCandidates = selection.validations.map((validation) => {
      const ranked = rankedByOriginalId.get(validation.candidate.id);
      return ranked ? { ...validation.candidate, candidateScore: ranked.candidateScore, selectionReason: ranked.selectionReason, rejectionReasons: ranked.rejectionReasons } : validation.candidate;
    });
    const fitted = fitReferenceCopyBlocks({ reference, copyBlocks: selected.copyBlocks });
    const byRole = (role: string) => selected.copyBlocks.filter((block) => block.role === role).map((block) => block.text).filter(Boolean).join("\n");
    const selectedHookIdea = plan.hookIdea?.creativeAngle === selected.creativeAngle
      ? plan.hookIdea
      : input.payload.hookIdeas.find((idea) => idea.creativeAngle === selected.creativeAngle) || plan.hookIdea;
    return {
      ...plan,
      evidenceAssignment,
      creativeAngle: selected.creativeAngle,
      hookIdea: selectedHookIdea,
      candidateMode: selected.candidateMode,
      claimModes: selected.claimModes,
      copyRiskFlags: selected.copyRiskFlags,
      copyReviewRequired: selected.copyReviewRequired,
      fullCopy: selected.fullCopy,
      copyBlocks: selected.copyBlocks,
      candidateScore: selected.candidateScore,
      candidateSelectionReason: selected.selectionReason,
      copyCandidates: storedCandidates,
      selectedCandidateId: selected.id,
      adaptedLines: fitted.adaptedLines,
      headline: byRole("headline") || selected.fullCopy.split("\n")[0] || "",
      subCopy: byRole("support"),
      proof: [byRole("proof"), byRole("badge"), byRole("other")].filter(Boolean).join("\n"),
      offer: byRole("offer"),
      cta: byRole("cta"),
      factIds: selected.coreFactIds,
      // 후보는 위의 결정적 eligibility를 통과했다. 모델의 자기평가 점수 대신
      // 서버 판정 점수를 저장해 별도 critic 호출 없이 동일 계약을 적용한다.
      naturalnessScore: 92,
      referenceFitScore: 92,
      factualSafetyScore: 100,
      validationErrors: [...new Set([...plan.validationErrors, ...fitted.budgetErrors])],
    };
  });
  return { ...input.payload, plans };
}

function reviewPlans(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  // 별도 AI critic을 열지 않는다. normalizePlan의 ProductTruth·슬롯 검증에
  // 문장 완결성과 배정 premise 검사를 합쳐 즉시 통과/보정 대상을 결정한다.
  return input.plans.map((plan) => {
    const naturalnessErrors = findReferenceCopyNaturalnessErrors(plan);
    const premiseErrors = findImageCreativePremiseCopyErrors(
      plan.creativePremise,
      [...(plan.adaptedLines || []), plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ")
    );
    const errors = [...new Set([...plan.validationErrors, ...naturalnessErrors, ...premiseErrors])];
    const factualErrors = errors.filter((error) => /ProductTruth|근거|수치|가격|할인|혜택|효능|함량|원산지|후기|배송|브랜드|업체명|판매자명|카테고리/u.test(error));
    const valid = errors.length === 0;
    return {
      ...plan,
      naturalnessScore: naturalnessErrors.length ? Math.max(0, 92 - naturalnessErrors.length * 20) : Math.max(90, plan.naturalnessScore),
      referenceFitScore: premiseErrors.length ? Math.max(0, 92 - premiseErrors.length * 20) : Math.max(90, plan.referenceFitScore),
      factualSafetyScore: factualErrors.length ? Math.max(0, 100 - factualErrors.length * 25) : 100,
      validationStatus: valid ? "valid" as const : "invalid" as const,
      validationErrors: valid ? [] : errors,
    };
  });
}

export async function prewarmReferenceCopyProfiles(references: NativeAdReference[]) {
  const hashes = await Promise.all(references.map(referenceHash));
  const cached = await readProfileCache();
  const existing = references.map((reference, index) => cached.find((profile) => profile.referenceId === reference.id && profile.referenceHash === hashes[index] && profile.profileVersion === REFERENCE_COPY_PROFILE_VERSION));
  const missingReferences = references.filter((_, index) => !existing[index]);
  if (!missingReferences.length) return { profiles: existing.filter((profile): profile is ReferenceCopyProfile => Boolean(profile)), analyzedCount: 0, fallbackCount: 0 };
  let analyzed: ProfilePayload["profiles"] = [];
  let analysisError = "";
  try {
    analyzed = (await runCodexJson<ProfilePayload>(profilePrompt(missingReferences), profileSchema)).profiles;
  } catch (error) {
    analysisError = error instanceof Error ? error.message : "레퍼런스 문구 구조 분석에 실패했습니다.";
  }
  const created = missingReferences.map((reference) => {
    const index = references.findIndex((candidate) => candidate.id === reference.id);
    const base = fallbackProfile(reference, hashes[index]);
    const raw = analyzed.find((profile) => profile.referenceId === reference.id);
    return raw ? { ...base, ...raw, analysisSource: "codex-local" as const, analysisError: undefined, createdAt: new Date().toISOString() } : { ...base, analysisError };
  });
  await writeProfileCache(created);
  const resolved = references.map((reference, index) => existing[index] || created.find((profile) => profile.referenceId === reference.id) || fallbackProfile(reference, hashes[index]));
  return { profiles: resolved, analyzedCount: created.filter((profile) => profile.analysisSource === "codex-local").length, fallbackCount: created.filter((profile) => profile.analysisSource === "safe-minimal").length };
}

/**
 * 작업 생성 요청은 사용자가 누른 버튼에 즉시 응답해야 한다. AI 문구 기획은
 * 서버 러너가 이어서 수행하고, 그 전까지는 레퍼런스 OCR 구조와 ProductTruth만
 * 사용한 렌더 가능한 초안을 저장한다. 이 초안은 이미지 생성에 바로 사용하지
 * 않고 referenceCopyPlanning 상태가 ready가 된 뒤에만 실행된다.
 */
export async function prepareReferenceAdaptedCopyScaffold(input: { truth: ProductTruth; references: NativeAdReference[] }) {
  const profiles = await Promise.all(input.references.map(async (reference) => {
    const profile = fallbackProfile(reference, await referenceHash(reference));
    const raw = reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "";
    return {
      ...profile,
      tone: /ㅋㅋ|;;|\.\.|\?!|!\?/.test(raw) ? "레퍼런스 원문 구어체" : "레퍼런스 원문 말투",
      rhetoricalDevice: referenceRhetoricalMechanism(reference),
      punctuationRhythm: raw.match(/[?!;.~ㅋ]+/gu)?.join(" ") || "원문 문장부호 최소 유지",
      headlineLineBudget: Math.max(1, Math.min(4, reference.nativeCopy?.textRegions.find((region) => region.role === "headline")?.lines.length || 2)),
      supportLineBudget: Math.max(0, Math.min(5, reference.nativeCopy?.rawLines.length || 2)),
      prohibitedLiteralPhrases: [],
      analysisSource: reference.nativeCopy?.extractionSource === "codex-local" ? "codex-local" as const : "safe-minimal" as const,
    };
  }));
  const evidenceAssignments = buildReferenceCopyEvidenceAssignments(input.truth, input.references);
  const premiseSeeds = alignPremiseSeedsToEvidenceAssignments(input.truth, buildImageCreativePremiseSeeds(input.truth, input.references), evidenceAssignments);
  const fallbackPlans = input.references.map((reference, index) => createEvidenceSafeMinimalPlan(input.truth, reference, profiles[index], index, premiseSeeds[index], evidenceAssignments[index]));
  return {
    profiles,
    plans: ensureRenderableReferencePlans({
      truth: input.truth,
      references: input.references,
      profiles,
      plans: fallbackPlans,
      premiseSeeds,
      evidenceAssignments,
    }),
    provider: "fallback" as const,
    warnings: ["작업을 먼저 저장하고 최신 문구 기획을 서버 대기열에서 준비합니다."],
  };
}


export { hydrateLeanPlannerPayload, planningPrompt, runPlanner, selectPlannerCandidates, reviewPlans };

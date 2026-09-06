import "server-only";

import { Codex } from "@openai/codex-sdk";
import { resolveFastCreativeRuntime, resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { extractNumericTokens } from "./productTruth";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import { findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";
import { normalizeReferenceRawLines } from "./referenceLibraryManagement";
import { resolveProductCopyDomain } from "./productCopySemantics";
import { buildImageCreativePremiseSeeds } from "./imageCreativePremise.ts";
import { buildReferenceSceneAdaptation, referenceContainsPerson } from "./referenceSceneAdaptation.ts";
import type { LoadedCopyGuide } from "../mvp/copyGuideLoader";
import type { ImageCreativePremise, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyBlock, ReferenceCopyCandidate, ReferenceCopyEvidenceAssignment, ReferenceCopyProfile } from "./types";

import {
  REFERENCE_COPY_PROFILE_VERSION,
  fallbackProfile,
  profileSchema,
  readProfileCache,
  referenceHash,
  writeProfileCache,
  type ProfilePayload,
} from "./referenceCopyProfiles.server";
import { leanPlannerSchema, type LeanPlannerPayload, type PlannerPayload } from "./referenceCopyCandidates.ts";
import { alignPremiseSeedsToEvidenceAssignments, assignCreativeAngles, buildReferenceCopyEvidenceAssignments, referenceRhetoricalMechanism } from "./referenceCopyAngles.ts";
import { isReferenceCopyTimeoutError, isRetryableReferenceCopyTransportError } from "./referenceCopyTransport.ts";
import {
  createEvidenceSafeMinimalPlan,
  ensureRenderableReferencePlans,
  factsForPlanning,
  isReferenceAdCopyRegion,
  referenceCopySourceLines,
  shortProductIdentity,
} from "./referenceCopyPlanningCore";

const DEFAULT_REFERENCE_COPY_TIMEOUT_MS = 60_000;

function compactCopyGuide(copyGuide?: LoadedCopyGuide | null) {
  if (!copyGuide?.content.trim()) return "없음 — 레퍼런스 OCR 말투와 상품 사실만 사용";
  const lines = copyGuide.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^```/u.test(line));
  const priority = lines.filter((line) => /금지|허용|말투|톤|문장|표현|강조|우선|가격|수치|예시/u.test(line));
  const selected = [...priority, ...lines].filter((line, index, all) => all.indexOf(line) === index).slice(0, 48);
  return selected.join("\n").slice(0, 6_000);
}

function planningFacts(input: Pick<Parameters<typeof planningPrompt>[0], "truth" | "premiseSeeds" | "evidenceAssignments">) {
  const requiredIds = new Set([
    ...input.premiseSeeds.flatMap((premise) => premise.supportingFactIds),
    ...input.evidenceAssignments.flatMap((assignment) => [assignment.primaryFactId, ...assignment.supportingFactIds]),
  ]);
  const all = factsForPlanning(input.truth);
  return [
    ...all.filter((fact) => requiredIds.has(fact.id)),
    ...all.filter((fact) => !requiredIds.has(fact.id)),
  ].filter((fact, index, values) => values.findIndex((candidate) => candidate.id === fact.id) === index).slice(0, 30);
}

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; premiseSeeds: ImageCreativePremise[]; evidenceAssignments: ReferenceCopyEvidenceAssignment[]; missingProfileIds: string[]; copyGuide?: LoadedCopyGuide | null; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  const facts = planningFacts(input);
  const repairByReference = new Map((input.repairPlans || []).map((plan) => [plan.referenceId, plan]));
  const contracts = input.references.map((reference, index) => {
    const profile = input.profiles[index];
    const adaptableRegions = (reference.nativeCopy?.textRegions || [])
      .filter(isReferenceAdCopyRegion)
      .slice(0, 10);
    const slots = adaptableRegions
      .map((region) => ({
        role: region.role,
        action: region.sourceType === "source-brand" || region.replacePolicy === "remove" ? "remove" : "replace",
        sourceType: region.sourceType,
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
      sourceContainsPerson: referenceContainsPerson(reference),
      sourceLines: referenceCopySourceLines(reference).slice(0, 20),
      slots,
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
업체 문구 가이드(핵심 규칙): ${compactCopyGuide(input.copyGuide)}

작성 규칙:
- 처음 보는 사람이 1초 안에 이해할 사람 말투의 완결된 광고 문장으로 쓴다.
- sourceLines와 slots.sourceLines는 저장·승인된 실제 OCR 원문이다. 원문의 상품명만 기계적으로 바꾸지 말고, 질문→대답·감탄→이유·문제→해결·USP→가격처럼 각 블록이 하던 광고 역할과 말투를 현재 상품으로 자연스럽게 다시 쓴다.
- source-product-label과 decorative OCR은 이미 제외됐다. 패키지에 인쇄된 라벨을 광고 헤드라인·보조 문구로 다시 쓰지 않는다.
- adaptedLines는 sourceLines와 정확히 같은 순서·개수로 반환한다. 같은 문장이 여러 줄인 경우 먼저 완결된 문장을 쓴 뒤 원본 줄 수에 맞춰 자연스럽게 줄바꿈한다.
- slots.action=remove인 원본 브랜드·고지 줄은 같은 위치의 adaptedLines를 빈 문자열로 반환한다. action=replace인 광고 문구만 현재 상품 문구로 채운다.
- headline/support/proof/offer/cta는 adaptedLines를 역할별로 묶은 동일 문구다. 원본에 가격판이나 CTA가 있으면 검증된 가격·혜택 또는 자연스러운 행동 문구로 그 역할을 유지한다.
- 특정 fact를 소재마다 강제로 하나씩 배정하지 않는다. 레퍼런스의 수사에 가장 잘 맞는 사용 가능한 사실을 고르고, 48시간 숙성·육즙처럼 강한 구매 이유는 여러 소재에서 반복해도 된다.
- factIds에는 실제 문구에서 사용한 사용 가능한 사실의 id만 넣는다. 계절·일상 상황·명백한 광고 감탄은 factIds에 넣지 않는다.
- 숫자·가격·구성·효능·원산지·인증은 사용 가능한 사실에 있을 때만 정확히 쓴다. 옵션 미확정 상품은 가격·할인·팩 수를 쓰지 않는다.
- 판매자 표기상, 확인된, 검증된, ProductTruth, OCR, 상품 정보 같은 근거 관리 말투와 깨진 한자·따옴표를 쓰지 않는다.
- 사실에 없는 부드러움·효능·후기·순위·전문가 추천·최저가·재고·품절·긴급성을 만들지 않는다.
- 자연스럽게 연결된 계절·시즌·유행·밈·사용 상황이 ProductTruth에 없다는 이유만으로 factualSafety를 감점하거나 오류로 판정하지 않는다. 단, 실제 후기·성과·이벤트처럼 쓰지는 않는다.
- 근거 없는 'SNS 1위'·'오늘만 할인'·'곧 품절'은 금지한다.
- 특별한 선택, 새로운 경험, 직접 느껴보세요, 상품 자세히 보기 같은 범용 문구만으로 채우지 않는다.
- 상품군을 추측해 간식·식탁·샤워 같은 상황을 임의로 넣지 않는다. 상품명과 사용 가능한 사실에 맞는 상황만 쓴다.
- 같은 이미지 안에서 상품명이나 동일 문장을 반복하지 않는다.
- 업체 가이드는 ${input.copyGuide?.brandName || "미지정"}의 말투 경계만 따르며 예문은 복사하지 않는다.
- 각 copy와 동시에 scene을 확정한다. expressionPrinciple은 레퍼런스의 표현 원리, subjectMode는 none/new-adult/product-character 중 하나, subjectRole/action/setting은 최종 adaptedLines가 실제로 보이게 하는 최소 장면이다.
- sourceContainsPerson는 원본 인물의 존재일 뿐 새 인물을 반드시 유지하라는 뜻이 아니다. 표현 역할에 따라 다른 새 성인, 상품 관련 캐릭터, 인물 없음 중 가장 자연스러운 하나를 고른다. 원본 얼굴·정체성·포즈·장소는 보존하지 않는다.
- 선물 선택·가격 비교·상품 발견 문구는 먹거나 몸에 사용하는 행동을 강제하지 않는다. 고르기·비교하기·휴대폰으로 살펴보기처럼 문구에 맞는 행동이면 충분하다.
- sourceContainsPerson가 false이면 이유 없이 사람을 추가하지 말고 기본값을 none으로 둔다. product-character는 레퍼런스의 캐릭터/의인화 표현 역할 또는 확정 문구가 명확히 요구할 때만 쓴다.

레퍼런스 분석 계약:
${JSON.stringify(contracts)}

${input.repairPlans?.length ? "repairErrors를 해결한 해당 소재만 다시 반환한다. 슬롯을 억지로 비우거나 범용 문구로 대체하지 않는다." : "여섯 계약에 대응하는 최종 문구를 정확히 한 개씩 반환한다."}`;
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
  const usableFactIds = new Set(input.truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .map((fact) => fact.id));
  const plans = input.references.flatMap((reference, index) => {
    const copy = input.payload.copies.find((candidate) => candidate.referenceId === reference.id);
    if (!copy) return [];
    const requestedFactIds = copy.factIds.filter((id) => usableFactIds.has(id));
    const copyText = [copy.headline, copy.support, copy.proof, copy.offer, ...copy.adaptedLines].join(" ");
    const numericTokens = new Set(extractNumericTokens(copyText));
    const inferredFactIds = input.truth.facts
      .filter((fact) => usableFactIds.has(fact.id))
      .filter((fact) => {
        const factText = fact.value.normalize("NFKC").replace(/[^0-9a-z가-힣]+/giu, "").toLowerCase();
        const rendered = copyText.normalize("NFKC").replace(/[^0-9a-z가-힣]+/giu, "").toLowerCase();
        return (factText.length >= 3 && rendered.includes(factText)) || fact.numericTokens.some((token) => numericTokens.has(token));
      })
      .map((fact) => fact.id);
    const identityFactId = input.truth.facts.find((fact) => fact.key === "base-product-name" && usableFactIds.has(fact.id))?.id;
    const factIds = [...new Set([...requestedFactIds, ...inferredFactIds, ...(requestedFactIds.length || inferredFactIds.length || !identityFactId ? [] : [identityFactId])])];
    const rawCopyBlocks: ReferenceCopyBlock[] = [
      { role: "headline", text: copy.headline.trim(), coreFactIds: factIds },
      { role: "support", text: copy.support.trim(), coreFactIds: factIds },
      { role: "proof", text: copy.proof.trim(), coreFactIds: factIds },
      { role: "offer", text: copy.offer.trim(), coreFactIds: factIds },
      { role: "cta", text: copy.cta.trim(), coreFactIds: [] },
    ];
    const copyBlocks = rawCopyBlocks.filter((block) => block.text);
    const adaptedLines = normalizeReferenceRawLines(copy.adaptedLines);
    const fullCopy = adaptedLines.filter(Boolean).join("\n") || copyBlocks.map((block) => block.text).join("\n");
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
      productDifferenceReason: factIds.length ? `실제 문구에 사용한 상품 근거 ${factIds.join(", ")}만 연결했습니다.` : "현재 상품의 이름과 레퍼런스 수사만 사용했습니다.",
      noveltyReason: "레퍼런스의 광고 역할을 보존하고 현재 상품 문장으로 다시 작성했습니다.",
    };
    const profile = input.profiles[index];
    return [{
      resultCode: `H${String(index + 1).padStart(2, "0")}`,
      referenceId: reference.id,
      creativePremise: input.premiseSeeds[index],
      sceneAdaptation: buildReferenceSceneAdaptation({
        truth: input.truth,
        reference,
        premise: input.premiseSeeds[index],
        mechanism: referenceRhetoricalMechanism(reference),
        copy: fullCopy,
        draft: copy.scene,
      }),
      observedSourceLines: referenceCopySourceLines(reference),
      adaptedLines,
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

async function runCodexJson<T>(prompt: string, outputSchema: object, retryCount = 0) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (!(await codexLocalAuthenticated({ force: true }))) throw new Error("로컬 Codex 로그인이 없습니다.");
      // 전송 오류 뒤에는 SDK/thread 인스턴스를 재사용하지 않는다. 특히 로컬 로그인
      // backend의 일시적 404는 새 thread에서 정상화되는 경우가 있다.
      const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
      const runtime = resolveFastCreativeRuntime();
      const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: runtime.plannerReasoning });
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

function reviewPlans(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  // 별도 AI critic/selector를 열지 않는다. ProductTruth와 문장 완결성 같은
  // 치명 오류만 즉시 검사하고, 밀도·그룹 다양성 같은 기획 점수는 문구를
  // 탈락시키는 조건으로 사용하지 않는다.
  return input.plans.map((plan) => {
    const naturalnessErrors = findReferenceCopyNaturalnessErrors(plan);
    const errors = [...new Set([...plan.validationErrors, ...naturalnessErrors])];
    const factualErrors = errors.filter((error) => /ProductTruth|근거|수치|가격|할인|혜택|효능|함량|원산지|후기|배송|브랜드|업체명|판매자명|카테고리/u.test(error));
    const blockingErrors = [...new Set([
      ...naturalnessErrors,
      ...errors.filter((error) => /ProductTruth|근거|수치|가격|할인|혜택|효능|함량|원산지|후기|배송|브랜드|업체명|판매자명|카테고리|불완전|연결어|문장 조각|괄호|빈 문구/u.test(error)),
    ])];
    const valid = blockingErrors.length === 0;
    const isFallback = plan.generationSource === "safe-minimal" || plan.generationSource === "validated-fallback" || plan.generationSource === "reference-best-effort";
    return {
      ...plan,
      // fallback은 제작 지속용이지 AI 고품질 원안이 아니다. 이후 로컬 검수가
      // 점수를 올려 실패 경로를 숨기지 않도록 원래 점수를 그대로 보존한다.
      naturalnessScore: naturalnessErrors.length ? Math.max(0, 92 - naturalnessErrors.length * 20) : isFallback ? plan.naturalnessScore : Math.max(90, plan.naturalnessScore),
      referenceFitScore: isFallback ? plan.referenceFitScore : Math.max(90, plan.referenceFitScore),
      factualSafetyScore: factualErrors.length ? Math.max(0, 100 - factualErrors.length * 25) : 100,
      validationStatus: valid ? "valid" as const : "invalid" as const,
      validationErrors: valid ? [] : blockingErrors,
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


export { hydrateLeanPlannerPayload, planningPrompt, runPlanner, reviewPlans };

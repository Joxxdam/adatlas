import "server-only";

import { Codex } from "@openai/codex-sdk";
import {
  buildHookCreativeBrief,
  buildProductHookExploration,
  buildProductInsightProfile,
  selectDiverseHookHypotheses,
  type CategoryHookPrior,
} from "./hookHypothesisEngine";
import { codexProductThreadKey, getAdvertiserThread, resetAdvertiserThread, saveAdvertiserThread } from "./codexRegistry.server";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { hookTaxonomyTags, type CreativePlan, type HookHypothesisCandidate, type HookTaxonomyTag, type ProductTruth } from "./types";

const PLANNER_VERSION = "codex-local-hook-planner-v1";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 12,
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["primaryTag", "hypothesis", "mainHook", "subCopy", "customerTension", "verifiedFactIds", "intendedReaction", "visualConcept", "sceneKey", "selectionReason", "prohibitedClaims", "scores"],
        properties: {
          primaryTag: { type: "string", enum: hookTaxonomyTags },
          hypothesis: { type: "string" },
          mainHook: { type: "string" },
          subCopy: { type: "string" },
          customerTension: { type: "string" },
          verifiedFactIds: { type: "array", items: { type: "string" } },
          intendedReaction: { type: "string" },
          visualConcept: { type: "string" },
          sceneKey: { type: "string" },
          selectionReason: { type: "string" },
          prohibitedClaims: { type: "array", items: { type: "string" } },
          scores: {
            type: "object",
            additionalProperties: false,
            required: ["evidenceStrength", "specificity", "distinctiveness", "attentionPotential", "visualizability", "advertisingFit"],
            properties: {
              evidenceStrength: { type: "integer", minimum: 0, maximum: 100 },
              specificity: { type: "integer", minimum: 0, maximum: 100 },
              distinctiveness: { type: "integer", minimum: 0, maximum: 100 },
              attentionPotential: { type: "integer", minimum: 0, maximum: 100 },
              visualizability: { type: "integer", minimum: 0, maximum: 100 },
              advertisingFit: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
        },
      },
    },
  },
} as const;

type PlannerResponse = {
  candidates: Array<{
    primaryTag: HookTaxonomyTag;
    hypothesis: string;
    mainHook: string;
    subCopy: string;
    customerTension: string;
    verifiedFactIds: string[];
    intendedReaction: string;
    visualConcept: string;
    sceneKey: string;
    selectionReason: string;
    prohibitedClaims: string[];
    scores: {
      evidenceStrength: number;
      specificity: number;
      distinctiveness: number;
      attentionPotential: number;
      visualizability: number;
      advertisingFit: number;
    };
  }>;
};

function clamp(value: unknown) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function visibleLength(value: string) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function planningIdentity(advertiserId: string, productId: string) {
  return `${codexProductThreadKey(advertiserId, productId)}--hook-planning`;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일")
    .slice(0, 300);
}

function plannerPrompt(truth: ProductTruth) {
  const facts = truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
    .map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, evidenceType: fact.evidenceType, source: fact.sourceUrl || fact.source }));
  return `당신은 한국 퍼포먼스 광고의 수석 크리에이티브 전략가다.
상품마다 완전히 고유한 후킹 가설 후보 12~15개를 만든다. 고정된 분류별로 하나씩 채우지 말고, 실제 상품 근거와 고객 긴장을 기준으로 좋은 방향이 겹치면 같은 태그를 여러 번 사용해도 된다.

필수 원칙:
- 확인된 fact id에 연결되지 않은 가격, 할인, 구성, 수량, 후기, 평점, 효능, 인증, 원산지 수치를 만들지 않는다.
- 상품명을 다시 쓰는 수준의 제목, 내부 전략 용어, 'USP 점검', '랜딩 조건', '광고 가설' 같은 문구를 금지한다.
- '사용하는 순간', '이 선택', '핵심 이유', '고를 이유', '한눈에', '새로운 사용 이유'처럼 어느 상품에도 붙일 수 있는 상투 문구를 금지한다.
- mainHook은 상품명보다 고객이 실제로 겪는 의외의 상황·감각·대조·질문을 앞세우고, 상세페이지에서만 발견할 수 있는 구체 근거와 연결한다.
- 여섯 최종 후보가 모두 같은 문장 구조가 되지 않도록 질문형·상황 묘사형·반전형·수치/근거형·대화형 등 문장 리듬도 다르게 설계한다.
- mainHook은 모바일에서 한눈에 읽히는 자연스러운 한국어, subCopy는 그 가설을 보완하는 한 줄이다.
- 각 후보는 고객 긴장, 의도한 반응, 실제로 시각화할 독립 장면을 구체적으로 다르게 만든다.
- 상세페이지 광고 배너를 복제하거나 자동 누끼를 전제로 하지 않는다.
- 점수는 근거 강도, 상품 특이성, 서로 다른 정도, 주목 가능성, 시각화 가능성, 실제 광고 적합성을 냉정하게 평가한다.

상품:
${JSON.stringify({ productName: truth.product.productName, brandName: truth.product.brandName, category: truth.product.category, targetCustomer: truth.product.targetCustomer, mainBenefit: truth.product.mainBenefit, facts }, null, 2)}

JSON 스키마에 맞춰 후보만 반환한다.`;
}

async function planningThread(codex: Codex, advertiserId: string, productId: string) {
  const registryId = planningIdentity(advertiserId, productId);
  const record = await getAdvertiserThread(registryId);
  const options = {
    workingDirectory: process.cwd(),
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "never" as const,
    networkAccessEnabled: false,
    model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
    modelReasoningEffort: "high" as const,
  };
  const limit = Math.max(10, Number(process.env.ADATLAS_CODEX_THREAD_MAX_TURNS || 60));
  if (record?.threadId && (record.turnCount || 0) < limit) {
    return { thread: codex.resumeThread(record.threadId, options), record, registryId, resumed: true };
  }
  if (record?.threadId) await resetAdvertiserThread(registryId);
  return { thread: codex.startThread(options), record, registryId, resumed: false };
}

async function runPlanner(truth: ProductTruth, advertiserId: string, advertiserName: string) {
  if (!(await codexLocalAuthenticated())) throw new Error("로컬 Codex 로그인 상태를 확인할 수 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  let current = await planningThread(codex, advertiserId, truth.productId);
  let response;
  try {
    response = await current.thread.run(plannerPrompt(truth), {
      outputSchema,
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_PLANNING_TIMEOUT_MS || 180_000)),
    });
  } catch (error) {
    if (!current.resumed) throw error;
    await resetAdvertiserThread(current.registryId);
    current = await planningThread(codex, advertiserId, truth.productId);
    response = await current.thread.run(plannerPrompt(truth), {
      outputSchema,
      signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_PLANNING_TIMEOUT_MS || 180_000)),
    });
  }
  await saveAdvertiserThread({
    advertiserId: current.registryId,
    advertiserName: `${advertiserName} · 후킹 기획`,
    domain: "local-planning",
    threadId: current.thread.id || undefined,
    turnCount: (current.record?.turnCount || 0) + 1,
  });
  return JSON.parse(response.finalResponse) as PlannerResponse;
}

function toCandidates(truth: ProductTruth, response: PlannerResponse, prior: CategoryHookPrior): HookHypothesisCandidate[] {
  const knownFacts = new Map(truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => [fact.id, fact]));
  return response.candidates.slice(0, 15).map((candidate, index) => {
    const factIds = [...new Set(candidate.verifiedFactIds)].filter((id) => knownFacts.has(id));
    const evidence = factIds.map((id) => knownFacts.get(id)!).map((fact) => ({ fact: `${fact.label}: ${fact.value}`, sourceReference: fact.sourceUrl || fact.source }));
    const s = candidate.scores;
    const evidenceStrength = factIds.length ? clamp(s.evidenceStrength) : Math.min(35, clamp(s.evidenceStrength));
    const specificity = clamp(s.specificity);
    const distinctiveness = clamp(s.distinctiveness);
    const attentionPotential = clamp(s.attentionPotential);
    const visualizability = clamp(s.visualizability);
    const advertisingFit = clamp(s.advertisingFit);
    const purchaseReasonStrength = advertisingFit;
    const claimSafety = factIds.length ? 96 : 60;
    const categoryPrior = clamp(prior[candidate.primaryTag] ?? 50);
    const novelty = distinctiveness;
    const total = Math.round(evidenceStrength * .2 + specificity * .15 + distinctiveness * .15 + attentionPotential * .15 + visualizability * .15 + advertisingFit * .15 + claimSafety * .05);
    const id = `codex-hypothesis-${String(index + 1).padStart(2, "0")}`;
    const mainHook = candidate.mainHook.trim().slice(0, 80);
    const subCopy = candidate.subCopy.trim().slice(0, 120);
    if (!mainHook || !subCopy || visibleLength(mainHook) > 44) throw new Error(`후킹 후보 ${index + 1}의 문구 형식이 올바르지 않습니다.`);
    const score = { evidenceStrength, specificity, purchaseReasonStrength, distinctiveness, attentionPotential, visualizability, advertisingFit, claimSafety, categoryPrior, novelty, total };
    const verifiedEvidence = evidence.map((item) => item.fact);
    return {
      id,
      primaryTag: hookTaxonomyTags.includes(candidate.primaryTag) ? candidate.primaryTag : "other",
      secondaryTags: [],
      hypothesis: candidate.hypothesis.trim(),
      mainHook,
      subCopy,
      customerReason: candidate.customerTension.trim(),
      customerTension: candidate.customerTension.trim(),
      verifiedEvidence,
      intendedReaction: candidate.intendedReaction.trim(),
      visualConcept: candidate.visualConcept.trim(),
      prohibitedClaims: candidate.prohibitedClaims.map(String).filter(Boolean).slice(0, 10),
      confidence: evidenceStrength >= 75 ? "high" : evidenceStrength >= 48 ? "medium" : "low",
      generationSource: "codex-local",
      selectionReason: candidate.selectionReason.trim(),
      evidenceSummary: verifiedEvidence.join(" · "),
      evidence,
      factIds,
      sceneKey: candidate.sceneKey.trim() || `scene-${index + 1}`,
      visualStory: candidate.visualConcept.trim(),
      score,
      status: "candidate",
      creativeBrief: buildHookCreativeBrief({
        id,
        tag: candidate.primaryTag,
        mainHook,
        subCopy,
        customerReason: candidate.customerTension,
        verifiedFacts: verifiedEvidence,
        visualStory: candidate.visualConcept,
        scene: candidate.visualConcept,
      }),
    };
  });
}

export async function planHooksWithCodexLocal(input: {
  truth: ProductTruth;
  advertiserId: string;
  advertiserName: string;
  prior?: CategoryHookPrior;
}): Promise<{ exploration: ReturnType<typeof buildProductHookExploration>; copyGeneration: CreativePlan["copyGeneration"] }> {
  const prior = input.prior || {};
  try {
    const response = await runPlanner(input.truth, input.advertiserId, input.advertiserName);
    const candidates = toCandidates(input.truth, response, prior);
    if (candidates.length < 12) throw new Error("Codex가 12개 미만의 후보를 반환했습니다.");
    const selected = selectDiverseHookHypotheses(candidates, 6);
    if (selected.length !== 6) throw new Error("서로 다른 최종 후킹 6개를 선정하지 못했습니다.");
    return {
      exploration: { profile: buildProductInsightProfile(input.truth), candidates, selected },
      copyGeneration: { provider: "codex-local", model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", warnings: [] },
    };
  } catch (error) {
    return {
      exploration: buildProductHookExploration(input.truth, prior),
      copyGeneration: {
        provider: "fallback",
        model: PLANNER_VERSION,
        warnings: [`로컬 Codex 후킹 기획을 사용할 수 없어 근거 기반 규칙 엔진을 사용했습니다: ${safeError(error)}`],
      },
    };
  }
}

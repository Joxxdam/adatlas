import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import { CURRENT_REFERENCE_COPY_POLICY_VERSION } from "./jobRunnerPolicy";
import type { CreativeBlueprintId, ReferenceCopyProfile } from "./types";
import { runtimeDataPath } from "../runtimeStorage.ts";

export const REFERENCE_COPY_PROFILE_VERSION = "reference-copy-profile-v1";
export const REFERENCE_ADAPTED_PLANNER_VERSION = CURRENT_REFERENCE_COPY_POLICY_VERSION;

const NATURALNESS_PASS_SCORE = 80;
const REFERENCE_FIT_PASS_SCORE = 80;

const cachePath = path.resolve(runtimeDataPath("creative-generation", "reference-copy-profiles.json"));
const sentenceStyles = ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"] as const;
let profileCacheWriteQueue: Promise<void> = Promise.resolve();

type ProfilePayload = { profiles: Array<Omit<ReferenceCopyProfile, "id" | "referenceHash" | "profileVersion" | "createdAt" | "analysisSource">> };

const profileProperties = {
  referenceId: { type: "string" }, tone: { type: "string" }, sentenceStyle: { type: "string", enum: sentenceStyles }, rhetoricalDevice: { type: "string" }, headlineRole: { type: "string" },
  headlineLineBudget: { type: "integer", minimum: 1, maximum: 4 }, headlineCharacterBudget: { type: "integer", minimum: 8, maximum: 70 }, supportRole: { type: "string" },
  supportLineBudget: { type: "integer", minimum: 0, maximum: 5 }, supportCharacterBudget: { type: "integer", minimum: 0, maximum: 120 },
  proofRole: { type: "string" }, offerRole: { type: "string" }, ctaRole: { type: "string" },
  numericEmphasis: { type: "string", enum: ["none", "light", "strong"] }, density: { type: "string", enum: ["light", "medium", "dense"] }, punctuationRhythm: { type: "string" }, prohibitedLiteralPhrases: { type: "array", items: { type: "string" }, maxItems: 12 },
} as const;

const profileRequired = ["referenceId", "tone", "sentenceStyle", "rhetoricalDevice", "headlineRole", "headlineLineBudget", "headlineCharacterBudget", "supportRole", "supportLineBudget", "supportCharacterBudget", "proofRole", "offerRole", "ctaRole", "numericEmphasis", "density", "punctuationRhythm", "prohibitedLiteralPhrases"] as const;

const profileSchema = {
  type: "object", additionalProperties: false, required: ["profiles"],
  properties: { profiles: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: profileRequired, properties: profileProperties } } },
} as const;

function blueprintForReference(reference: NativeAdReference): CreativeBlueprintId {
  const value = reference.layoutFamily.toLowerCase();
  if (/chat|review|dialogue/.test(value)) return "chat-ugc";
  if (/compare|versus|problem|objection/.test(value)) return "problem-solution-split";
  if (/proof|data|price|offer/.test(value)) return "proof-data";
  if (/editorial|story|usage|lifestyle/.test(value)) return "editorial-story";
  return "product-hero-lifestyle";
}

function fallbackProfile(reference: NativeAdReference, referenceHash: string): ReferenceCopyProfile {
  const dense = reference.textDensity === "dense";
  const price = /price|offer/.test(reference.layoutFamily);
  return {
    id: `${reference.id}:${referenceHash.slice(0, 12)}:${REFERENCE_COPY_PROFILE_VERSION}`,
    referenceId: reference.id,
    referenceHash,
    profileVersion: REFERENCE_COPY_PROFILE_VERSION,
    tone: price ? "짧고 직접적인 판매 정보형" : "간결한 상품 소개형",
    sentenceStyle: price ? "proof" : "declaration",
    rhetoricalDevice: price ? "사실 제시" : "핵심 특징 요약",
    headlineRole: "가장 먼저 읽히는 상품 핵심 문장",
    headlineLineBudget: 2,
    headlineCharacterBudget: dense ? 30 : 24,
    supportRole: "헤드라인을 보충하는 한 문장",
    supportLineBudget: dense ? 3 : 2,
    supportCharacterBudget: dense ? 56 : 40,
    proofRole: "검증된 상품 사실만 짧게 제시",
    offerRole: price ? "가격·혜택 사실이 있을 때만 강조" : "필요할 때만 표시",
    ctaRole: "원본 레퍼런스에 CTA 영역이 있을 때만 짧게 표시",
    numericEmphasis: price ? "strong" : "light",
    density: reference.textDensity || "medium",
    punctuationRhythm: "짧은 한국어 문장과 최소한의 문장부호",
    prohibitedLiteralPhrases: [],
    analysisSource: "safe-minimal",
    createdAt: new Date().toISOString(),
  };
}

async function referenceHash(reference: NativeAdReference) {
  try {
    return createHash("sha256").update(await fs.readFile(reference.path)).digest("hex");
  } catch {
    return createHash("sha256").update(`${reference.id}:${reference.publicPath}`).digest("hex");
  }
}

async function readProfileCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as { profiles?: ReferenceCopyProfile[] };
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch {
    return [];
  }
}

async function writeProfileCache(profiles: ReferenceCopyProfile[]) {
  profileCacheWriteQueue = profileCacheWriteQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const previous = await readProfileCache();
    const keyed = new Map(previous.map((profile) => [`${profile.referenceId}:${profile.referenceHash}:${profile.profileVersion}`, profile]));
    profiles.forEach((profile) => keyed.set(`${profile.referenceId}:${profile.referenceHash}:${profile.profileVersion}`, profile));
    const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: REFERENCE_COPY_PROFILE_VERSION, profiles: [...keyed.values()] }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, cachePath);
  });
  await profileCacheWriteQueue;
}


export {
  NATURALNESS_PASS_SCORE,
  REFERENCE_FIT_PASS_SCORE,
  sentenceStyles,
  profileSchema,
  blueprintForReference,
  fallbackProfile,
  referenceHash,
  readProfileCache,
  writeProfileCache,
};
export type { ProfilePayload };

import { createAutomaticSafeCandidate } from "./referenceCopyClaims.ts";
import { validateReferenceCopyCandidate, type ReferenceCopyCandidateValidation } from "./referenceCopyCandidateValidation.ts";
import type { ProductTruth, ReferenceCopyCandidate, ReferenceCopyCandidateScore, ReferenceCopyEvidenceAssignment } from "./types.ts";

export const REFERENCE_COPY_SELECTOR_WEIGHTS = {
  stopPower: 20,
  productDifference: 20,
  humanVoice: 20,
  concretePurchaseReason: 15,
  referenceFit: 20,
  novelty: 5,
} as const;

export type ReferenceCopySelectorReview = {
  candidateId: string;
  stopPower: number;
  productDifference: number;
  humanVoice: number;
  concretePurchaseReason: number;
  referenceFit: number;
  novelty: number;
  selectionReason: string;
  rejectionReasons: string[];
};

function bounded(value: number, fallback = 50) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function heuristicReview(candidate: ReferenceCopyCandidate): ReferenceCopySelectorReview {
  const text = candidate.fullCopy;
  const concrete = candidate.coreFactIds.length > 0;
  return {
    candidateId: candidate.id,
    stopPower: /[?!]|;;|ㅋㅋ|왜|말고|아니|놀라|미쳤|반전/u.test(text) ? 82 : 62,
    productDifference: concrete ? 78 : 42,
    humanVoice: /(?:요|죠|네|까|어때|ㄹㅇ|;;|ㅋㅋ|왜)/u.test(text) ? 80 : 60,
    concretePurchaseReason: concrete ? 80 : 38,
    referenceFit: candidate.referenceFitReason.trim() ? 80 : 45,
    novelty: candidate.noveltyReason.trim() ? 78 : 45,
    selectionReason: "결정적 검증과 상품 특화·사람 말투 휴리스틱으로 평가했습니다.",
    rejectionReasons: [],
  };
}

export function scoreReferenceCopyCandidate(validation: ReferenceCopyCandidateValidation, review?: ReferenceCopySelectorReview): ReferenceCopyCandidateScore {
  const scored = review || heuristicReview(validation.candidate);
  const weighted =
    bounded(scored.stopPower) * REFERENCE_COPY_SELECTOR_WEIGHTS.stopPower / 100 +
    bounded(scored.productDifference) * REFERENCE_COPY_SELECTOR_WEIGHTS.productDifference / 100 +
    bounded(scored.humanVoice) * REFERENCE_COPY_SELECTOR_WEIGHTS.humanVoice / 100 +
    bounded(scored.concretePurchaseReason) * REFERENCE_COPY_SELECTOR_WEIGHTS.concretePurchaseReason / 100 +
    bounded(scored.referenceFit) * REFERENCE_COPY_SELECTOR_WEIGHTS.referenceFit / 100 +
    bounded(scored.novelty) * REFERENCE_COPY_SELECTOR_WEIGHTS.novelty / 100;
  const penalties = validation.penalties;
  return {
    stopPower: bounded(scored.stopPower),
    productDifference: bounded(scored.productDifference),
    humanVoice: bounded(scored.humanVoice),
    concretePurchaseReason: bounded(scored.concretePurchaseReason),
    referenceFit: bounded(scored.referenceFit),
    novelty: bounded(scored.novelty),
    ...penalties,
    total: Math.max(0, Math.round(weighted - Object.values(penalties).reduce((sum, value) => sum + value, 0))),
  };
}

export function selectReferenceCopyCandidate(input: {
  candidates: ReferenceCopyCandidate[];
  truth: ProductTruth;
  evidenceAssignment?: ReferenceCopyEvidenceAssignment;
  reviews?: ReferenceCopySelectorReview[];
  comparisonCopies?: string[];
  siblingCopies?: string[];
}) {
  const validations = input.candidates.map((candidate) => validateReferenceCopyCandidate({
    candidate,
    truth: input.truth,
    evidenceAssignment: input.evidenceAssignment,
    comparisonCopies: input.comparisonCopies,
    siblingCopies: input.siblingCopies,
  }));
  const automaticCandidates = validations.flatMap((validation) => {
    if (!validation.eligible) return [];
    const safe = createAutomaticSafeCandidate(validation.candidate, input.truth);
    if (!safe) return [];
    return [safe.id === validation.candidate.id ? validation : validateReferenceCopyCandidate({ candidate: safe, truth: input.truth, evidenceAssignment: input.evidenceAssignment, comparisonCopies: input.comparisonCopies, siblingCopies: input.siblingCopies })];
  });
  const ranked = automaticCandidates
    .filter((validation) => validation.eligible)
    .map((validation) => {
      const review = input.reviews?.find((candidate) => candidate.candidateId === validation.candidate.id || candidate.candidateId === validation.candidate.id.replace(/-safe$/, ""));
      const candidateScore = scoreReferenceCopyCandidate(validation, review);
      return {
        ...validation.candidate,
        candidateScore,
        selectionReason: validation.candidate.selectionReason || review?.selectionReason || heuristicReview(validation.candidate).selectionReason,
        rejectionReasons: review?.rejectionReasons || validation.errors,
      };
    })
    .sort((left, right) => (right.candidateScore?.total || 0) - (left.candidateScore?.total || 0));
  return { selected: ranked[0], ranked, validations };
}

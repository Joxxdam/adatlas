import type { AdImageLabel } from "./types";

export function formatReferenceLabelsForCopyGeneration(referenceLabels: AdImageLabel[]): string {
  return referenceLabels
    .map((record, index) => {
      const label = record.finalLabel;

      if (!label) {
        return "";
      }

      return `
[Reference ${index + 1}]
- imageId: ${record.imageId}
- category: ${label.category ?? ""}
- hookType: ${label.hookType ?? ""}
- appealPoint: ${label.appealPoint ?? ""}

[핵심 문구 전략 필드]
- firstLineHook: ${label.firstLineHook ?? ""}
- copyStructure: ${label.copyStructure ?? ""}
- toneOfVoice: ${label.toneOfVoice ?? ""}
- copyNuance: ${label.copyNuance ?? ""}
- trendElements: ${label.trendElements ?? ""}
- consumerInsight: ${label.consumerInsight ?? ""}
- purchaseTrigger: ${label.purchaseTrigger ?? ""}
- reusableCopyPattern: ${label.reusableCopyPattern ?? ""}

[비주얼/문구 관계 참고]
- ocrText: ${label.ocrText ?? ""}
- targetEmotion: ${label.targetEmotion ?? ""}
- visualTone: ${label.visualTone ?? ""}
- layoutPattern: ${label.layoutPattern ?? ""}
- visualCopyRelation: ${label.visualCopyRelation ?? ""}
- whyItWorks: ${label.whyItWorks ?? ""}
- recommendedUse: ${label.recommendedUse ?? ""}
`;
    })
    .filter(Boolean)
    .join("\n\n");
}

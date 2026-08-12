"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { defaultAdBrief, productInfoToAdBrief } from "../../../lib/mvp/adBrief";
import { buildCreativeStrategies } from "../../../lib/mvp/creativeStrategy";
import { labelsForReferenceMatches, matchReferences } from "../../../lib/mvp/referenceMatcher";
import { normalizeReferenceUsages } from "../../../lib/mvp/referenceUsage";
import type {
  AdBrief,
  AdImageLabel,
  CreationStepId,
  CreativeStrategy,
  MessageHierarchy,
  ProductInfoForPrompt,
} from "../../../lib/mvp/types";

const emptyHierarchy: MessageHierarchy = {
  primaryMessage: "",
  secondaryMessage: "",
  proofMessage: "",
  offerMessage: "",
  actionMessage: "",
};

export function useCreativeWorkflow(params: {
  productInfo: ProductInfoForPrompt;
  allReferences: AdImageLabel[];
  preferredReferenceIds?: string[];
  advertiserName?: string;
}) {
  const [activeStep, setActiveStep] = useState<CreationStepId>("brief");
  const [adBriefDraft, setAdBriefDraft] = useState<AdBrief>(() =>
    productInfoToAdBrief(params.productInfo, defaultAdBrief)
  );
  const [strategies, setStrategies] = useState<CreativeStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [strategyBatch, setStrategyBatch] = useState(0);
  const [isGeneratingStrategies, setIsGeneratingStrategies] = useState(false);
  const [messageHierarchy, setMessageHierarchy] = useState<MessageHierarchy>(emptyHierarchy);

  const adBrief = useMemo(
    () => productInfoToAdBrief(params.productInfo, adBriefDraft),
    [adBriefDraft, params.productInfo]
  );
  const setAdBrief = useCallback(
    (next: SetStateAction<AdBrief>) => {
      setAdBriefDraft((currentDraft) => {
        const current = productInfoToAdBrief(params.productInfo, currentDraft);
        return typeof next === "function" ? next(current) : next;
      });
    },
    [params.productInfo]
  );
  const referenceMatches = useMemo(() => {
    const matches = matchReferences({
      product: params.productInfo,
      brief: adBrief,
      labels: params.allReferences,
      limit: 5,
    });
    const preferredOrder = new Map(
      (params.preferredReferenceIds || []).map((id, index) => [id, index])
    );
    return matches.sort((a, b) => {
      const aOrder = preferredOrder.get(a.referenceId);
      const bOrder = preferredOrder.get(b.referenceId);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return b.score - a.score;
    });
  }, [adBrief, params.allReferences, params.preferredReferenceIds, params.productInfo]);
  const references = useMemo(
    () => labelsForReferenceMatches(params.allReferences, referenceMatches),
    [params.allReferences, referenceMatches]
  );
  const referenceUsages = useMemo(() => normalizeReferenceUsages(references, []), [references]);

  const generateStrategies = useCallback(
    async (nextBatch = strategyBatch) => {
      setIsGeneratingStrategies(true);
      try {
        const response = await fetch("/api/strategy/generate-directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productInfo: {
              ...params.productInfo,
              advertiserName: params.advertiserName || params.productInfo.advertiserName,
              brandName:
                params.productInfo.brandName ||
                params.advertiserName ||
                params.productInfo.advertiserName,
            },
            adBrief,
            batch: nextBatch,
          }),
        });
        const result = await response.json();
        const hooks = Array.isArray(result.hooks) ? result.hooks : result.strategies;
        if (!response.ok || !result.ok || !Array.isArray(hooks) || hooks.length !== 6) {
          throw new Error(result.error || "광고문구 6개 생성 실패");
        }
        setStrategies(hooks);
        setSelectedStrategyId(hooks[0]?.id || "");
        setStrategyBatch(nextBatch);
        setActiveStep("strategy");
        return hooks as CreativeStrategy[];
      } catch {
        const fallback = buildCreativeStrategies({
          brief: adBrief,
          references,
          usages: referenceUsages,
          batch: nextBatch,
          product: params.productInfo,
        });
        setStrategies(fallback);
        setSelectedStrategyId(fallback[0]?.id || "");
        setStrategyBatch(nextBatch);
        setActiveStep("strategy");
        return fallback;
      } finally {
        setIsGeneratingStrategies(false);
      }
    },
    [adBrief, params.advertiserName, params.productInfo, referenceUsages, references, strategyBatch]
  );

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) || null,
    [selectedStrategyId, strategies]
  );

  const resetStrategies = useCallback(() => {
    setStrategies([]);
    setSelectedStrategyId("");
    setStrategyBatch(0);
    setMessageHierarchy(emptyHierarchy);
    setActiveStep("brief");
  }, []);

  return {
    activeStep,
    setActiveStep,
    adBrief,
    setAdBrief,
    referenceMatches,
    references,
    referenceUsages,
    strategies,
    selectedStrategy,
    selectedStrategyId,
    setSelectedStrategyId,
    isGeneratingStrategies,
    generateStrategies,
    generateMoreStrategies: () => generateStrategies(strategyBatch + 1),
    resetStrategies,
    messageHierarchy,
    setMessageHierarchy,
  };
}

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
  const referenceMatches = useMemo(
    () =>
      matchReferences({
        product: params.productInfo,
        brief: adBrief,
        labels: params.allReferences,
        limit: 5,
      }),
    [adBrief, params.allReferences, params.productInfo]
  );
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
            productInfo: params.productInfo,
            adBrief,
            batch: nextBatch,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok || !Array.isArray(result.strategies)) {
          throw new Error(result.error || "광고 전략 생성 실패");
        }
        setStrategies(result.strategies);
        setSelectedStrategyId("");
        setStrategyBatch(nextBatch);
        setActiveStep("strategy");
        return result.strategies as CreativeStrategy[];
      } catch {
        const fallback = buildCreativeStrategies({
          brief: adBrief,
          references,
          usages: referenceUsages,
          batch: nextBatch,
        });
        setStrategies(fallback);
        setSelectedStrategyId("");
        setStrategyBatch(nextBatch);
        setActiveStep("strategy");
        return fallback;
      } finally {
        setIsGeneratingStrategies(false);
      }
    },
    [adBrief, params.productInfo, referenceUsages, references, strategyBatch]
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

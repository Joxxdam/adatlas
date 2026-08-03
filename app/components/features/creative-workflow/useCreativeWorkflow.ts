"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { defaultAdBrief, productInfoToAdBrief } from "../../../lib/mvp/adBrief";
import { buildCreativeStrategies } from "../../../lib/mvp/creativeStrategy";
import { normalizeReferenceUsages } from "../../../lib/mvp/referenceUsage";
import type {
  AdBrief,
  AdImageLabel,
  CreationStepId,
  CreativeStrategy,
  MessageHierarchy,
  ProductInfoForPrompt,
  ReferenceUsageSelection,
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
  references: AdImageLabel[];
}) {
  const [activeStep, setActiveStep] = useState<CreationStepId>("brief");
  const [adBriefDraft, setAdBriefDraft] = useState<AdBrief>(() =>
    productInfoToAdBrief(params.productInfo, defaultAdBrief)
  );
  const [referenceUsageDrafts, setReferenceUsageDrafts] = useState<ReferenceUsageSelection[]>([]);
  const [strategies, setStrategies] = useState<CreativeStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [strategyBatch, setStrategyBatch] = useState(0);
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
  const referenceUsages = useMemo(
    () => normalizeReferenceUsages(params.references, referenceUsageDrafts),
    [params.references, referenceUsageDrafts]
  );
  const setReferenceUsages = useCallback((next: ReferenceUsageSelection[]) => {
    setReferenceUsageDrafts(next);
  }, []);

  const generateStrategies = useCallback(
    (nextBatch = strategyBatch) => {
      const generated = buildCreativeStrategies({
        brief: adBrief,
        references: params.references,
        usages: referenceUsages,
        batch: nextBatch,
      });
      setStrategies(generated);
      setSelectedStrategyId("");
      setStrategyBatch(nextBatch);
      setActiveStep("strategy");
      return generated;
    },
    [adBrief, params.references, referenceUsages, strategyBatch]
  );

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) || null,
    [selectedStrategyId, strategies]
  );

  return {
    activeStep,
    setActiveStep,
    adBrief,
    setAdBrief,
    referenceUsages,
    setReferenceUsages,
    strategies,
    selectedStrategy,
    selectedStrategyId,
    setSelectedStrategyId,
    generateStrategies,
    generateMoreStrategies: () => generateStrategies(strategyBatch + 1),
    messageHierarchy,
    setMessageHierarchy,
  };
}

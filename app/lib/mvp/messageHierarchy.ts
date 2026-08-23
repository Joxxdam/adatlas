import type { GeneratedAdCopy, MessageHierarchy } from "./types";

export function copyToMessageHierarchy(copy: GeneratedAdCopy): MessageHierarchy {
  return {
    primaryMessage: copy.headline || "",
    secondaryMessage: copy.bodyCopy || "",
    proofMessage: copy.highlightCopy || "",
    offerMessage: copy.bottomBarCopy || copy.price || "",
    actionMessage: copy.cta || "",
  };
}

export function messageHierarchyToCopy(hierarchy: MessageHierarchy, base: GeneratedAdCopy): GeneratedAdCopy {
  return {
    ...base,
    headline: hierarchy.primaryMessage,
    bodyCopy: hierarchy.secondaryMessage,
    highlightCopy: hierarchy.proofMessage,
    bottomBarCopy: hierarchy.offerMessage,
    cta: hierarchy.actionMessage,
  };
}

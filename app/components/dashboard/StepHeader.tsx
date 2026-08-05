"use client";

import type { CreationStepId } from "../../lib/mvp/types";
import styles from "../features/creative-workflow/CreativeWorkflow.module.css";

const steps: Array<{ id: CreationStepId; label: string }> = [
  { id: "brief", label: "상품·브리프" },
  { id: "strategy", label: "광고 후킹" },
  { id: "copy", label: "카피" },
  { id: "visual", label: "비주얼" },
  { id: "edit", label: "편집" },
  { id: "export", label: "다운로드" },
];

export function StepHeader(props: {
  activeStep: CreationStepId;
  onStepChange: (step: CreationStepId) => void;
}) {
  return (
    <nav aria-label="광고 제작 단계" className={styles.stepNav}>
      {steps.map((step, index) => (
        <button
          className={`${styles.stepButton} ${
            props.activeStep === step.id ? styles.stepButtonActive : ""
          }`}
          key={step.id}
          onClick={() => props.onStepChange(step.id)}
          type="button"
        >
          <span className={styles.stepNumber}>STEP {index + 1}</span>
          {step.label}
        </button>
      ))}
    </nav>
  );
}

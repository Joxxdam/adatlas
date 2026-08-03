"use client";

import type { CreativeIntensity } from "../../../lib/mvp/types";
import type { ReactNode } from "react";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export type BasicEditorSettings = {
  creativeIntensity: CreativeIntensity;
  accentColor: string;
  textSizeLevel: "small" | "medium" | "large";
  productSizeLevel: "small" | "medium" | "large";
  backgroundBrightness: "dark" | "balanced" | "bright";
  overallMood: string;
};

export function BasicStyleControls(props: {
  value: BasicEditorSettings;
  onChange: (value: BasicEditorSettings) => void;
  children?: ReactNode;
}) {
  const set = <Key extends keyof BasicEditorSettings>(key: Key, value: BasicEditorSettings[Key]) =>
    props.onChange({ ...props.value, [key]: value });
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>기본 스타일</h4>
          <p>광고 인상에 큰 영향을 주는 항목만 먼저 조정합니다.</p>
        </div>
      </div>
      <div className={styles.controlGrid}>
        <label className={styles.field}>
          광고 강도
          <select
            value={props.value.creativeIntensity}
            onChange={(event) => set("creativeIntensity", event.target.value as CreativeIntensity)}
          >
            <option value="brand">브랜드 중심</option>
            <option value="balanced">균형형</option>
            <option value="performance">성과 중심</option>
          </select>
        </label>
        <label className={styles.field}>
          강조 색상
          <input
            type="color"
            value={props.value.accentColor}
            onChange={(event) => set("accentColor", event.target.value)}
          />
        </label>
        <label className={styles.field}>
          문구 크기
          <select
            value={props.value.textSizeLevel}
            onChange={(event) =>
              set("textSizeLevel", event.target.value as BasicEditorSettings["textSizeLevel"])
            }
          >
            <option value="small">작게</option>
            <option value="medium">보통</option>
            <option value="large">크게</option>
          </select>
        </label>
        <label className={styles.field}>
          상품 크기
          <select
            value={props.value.productSizeLevel}
            onChange={(event) =>
              set("productSizeLevel", event.target.value as BasicEditorSettings["productSizeLevel"])
            }
          >
            <option value="small">작게</option>
            <option value="medium">보통</option>
            <option value="large">크게</option>
          </select>
        </label>
        <label className={styles.field}>
          배경 밝기
          <select
            value={props.value.backgroundBrightness}
            onChange={(event) =>
              set(
                "backgroundBrightness",
                event.target.value as BasicEditorSettings["backgroundBrightness"]
              )
            }
          >
            <option value="dark">어둡게</option>
            <option value="balanced">보통</option>
            <option value="bright">밝게</option>
          </select>
        </label>
        <label className={styles.field}>
          전체 분위기
          <input
            value={props.value.overallMood}
            onChange={(event) => set("overallMood", event.target.value)}
            placeholder="예: 선명한 특가형"
          />
        </label>
      </div>
      {props.children ? (
        <details className={styles.advancedDetails}>
          <summary>고급 설정 열기</summary>
          {props.children}
        </details>
      ) : null}
    </section>
  );
}

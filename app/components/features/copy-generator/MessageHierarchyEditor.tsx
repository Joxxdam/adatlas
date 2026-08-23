"use client";

import type { MessageHierarchy } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

const fields: Array<{ key: keyof MessageHierarchy; label: string }> = [
  { key: "primaryMessage", label: "1차 메시지" },
  { key: "secondaryMessage", label: "2차 설명" },
  { key: "proofMessage", label: "증명·근거" },
  { key: "offerMessage", label: "혜택·오퍼" },
  { key: "actionMessage", label: "행동 유도" },
];

export function MessageHierarchyEditor(props: { value: MessageHierarchy; onChange: (value: MessageHierarchy) => void }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>메시지 우선순위</h4>
          <p>광고가 전달할 순서를 먼저 정리하고 현재 템플릿의 문구 슬롯에 연결합니다.</p>
        </div>
      </div>
      <div className={styles.hierarchyGrid}>
        {fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input value={props.value[field.key]} onChange={(event) => props.onChange({ ...props.value, [field.key]: event.target.value })} />
          </label>
        ))}
      </div>
    </section>
  );
}

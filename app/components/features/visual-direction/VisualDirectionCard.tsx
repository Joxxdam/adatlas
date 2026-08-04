"use client";

import type { CreativeQualityScore, VisualDirection } from "../../../lib/creative/types";
import styles from "./VisualDirection.module.css";

export function VisualDirectionCard(props: {
  direction: VisualDirection;
  quality?: CreativeQualityScore;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={props.selected}
      className={`${styles.directionCard} ${props.selected ? styles.selected : ""}`}
      onClick={props.onSelect}
      type="button"
    >
      <span className={styles.cardTopline}>
        <b>{props.direction.title}</b>
        {props.quality ? <em>{props.quality.overall}점</em> : null}
      </span>
      <dl>
        <div>
          <dt>배경</dt>
          <dd>{props.direction.scenePromptPlan.sceneType}</dd>
        </div>
        <div>
          <dt>제품</dt>
          <dd>{props.direction.productArrangement.placement}</dd>
        </div>
        <div>
          <dt>글자</dt>
          <dd>{props.direction.textStylePresetId}</dd>
        </div>
      </dl>
      <p>{props.direction.reason}</p>
      <span className={styles.patterns}>
        {props.direction.graphicComponents.slice(0, 4).map((component) => (
          <small key={component}>{component}</small>
        ))}
      </span>
      <strong className={styles.selectLabel}>{props.selected ? "선택됨" : "이 방향 선택"}</strong>
    </button>
  );
}

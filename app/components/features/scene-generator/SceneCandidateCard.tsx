"use client";

import type { SceneCandidate } from "../../../lib/creative/types";
import styles from "./SceneGeneration.module.css";

export function SceneCandidateCard(props: { candidate: SceneCandidate; selected: boolean; onSelect: () => void }) {
  return (
    <button aria-pressed={props.selected} className={`${styles.candidate} ${props.selected ? styles.selected : ""}`} onClick={props.onSelect} type="button">
      <img alt={`${props.candidate.sceneType} 배경 후보`} src={props.candidate.imagePath} />
      <span>
        <b>{props.candidate.sceneType}</b>
        <em>{props.candidate.fallback ? "안전 배경" : props.candidate.provider}</em>
      </span>
      <div className={styles.candidateMeta}>
        <small>상품 {props.candidate.productSafeZone.position}</small>
        {props.candidate.quality ? (
          <small className={`${styles.qualityBadge} ${styles[props.candidate.quality.status]}`} title={props.candidate.quality.reasons.join(" ") || "기술 품질 검사를 통과했습니다."}>
            품질 {props.candidate.quality.score}
          </small>
        ) : null}
      </div>
      <strong>{props.selected ? "현재 배경" : "이 배경 사용"}</strong>
    </button>
  );
}

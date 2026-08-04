"use client";

import type { CreativeQualityScore, VisualDirection } from "../../../lib/creative/types";
import { VisualDirectionCard } from "./VisualDirectionCard";
import styles from "./VisualDirection.module.css";

export function VisualDirectionPanel(props: {
  directions: VisualDirection[];
  selectedDirectionId: string;
  qualityScores: Record<string, CreativeQualityScore>;
  advertiserName?: string;
  loading: boolean;
  status: string;
  onGenerate: () => void;
  onSelect: (direction: VisualDirection) => void;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <span>VISUAL DIRECTION</span>
          <h4>광고 비주얼 방향</h4>
        </div>
        <button disabled={props.loading} onClick={props.onGenerate} type="button">
          {props.loading ? "구성 중" : props.directions.length ? "다시 추천" : "3개 방향 추천"}
        </button>
      </header>
      {props.advertiserName ? <p className={styles.profile}>적용 프로필: {props.advertiserName}</p> : null}
      {props.directions.length ? (
        <div className={styles.directionGrid}>
          {props.directions.map((direction) => (
            <VisualDirectionCard
              direction={direction}
              key={direction.id}
              onSelect={() => props.onSelect(direction)}
              quality={props.qualityScores[direction.id]}
              selected={props.selectedDirectionId === direction.id}
            />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>문구 생성 후 비주얼 방향 3개를 추천받을 수 있습니다.</p>
      )}
      {props.status ? <p className={styles.status}>{props.status}</p> : null}
    </section>
  );
}

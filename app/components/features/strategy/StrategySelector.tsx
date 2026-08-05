"use client";

import type { CreativeStrategy } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function StrategySelector(props: {
  strategies: CreativeStrategy[];
  selectedStrategyId: string;
  onSelect: (id: string) => void;
  onGenerate: () => void;
  onGenerateMore: () => void;
  isGenerating?: boolean;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>광고 후킹 3안</h4>
          <p>상품 사실을 바탕으로 소구와 장면이 겹치지 않게 제안했습니다.</p>
        </div>
      </div>
      {props.strategies.length ? (
        <div className={styles.strategyGrid}>
          {props.strategies.slice(0, 3).map((strategy, index) => (
            <label
              className={`${styles.strategyCard} ${props.selectedStrategyId === strategy.id ? styles.strategyCardSelected : ""}`}
              key={strategy.id}
            >
              <input
                checked={props.selectedStrategyId === strategy.id}
                name="creative-strategy"
                onChange={() => props.onSelect(strategy.id)}
                type="radio"
              />
              <span className={styles.strategyIndex}>후킹 {index + 1}</span>
              <h5>{strategy.title}</h5>
              <dl className={styles.strategyMeta}>
                <div className={`${styles.strategyMetaItem} ${styles.strategyMainCopy}`}>
                  <dt>헤드라인</dt>
                  <dd>{strategy.headline || strategy.mainCopy || strategy.mainHookAngle}</dd>
                </div>
                <div className={styles.strategyMetaItem}>
                  <dt>핵심 소구</dt>
                  <dd>{strategy.keyAppeal || strategy.appeal || strategy.coreAppealPoint}</dd>
                </div>
                <div className={styles.strategyMetaItem}>
                  <dt>장면</dt>
                  <dd>{strategy.sceneDescription || strategy.suggestedVisualEmphasis}</dd>
                </div>
              </dl>
              <span className={styles.strategySelectLabel}>
                {props.selectedStrategyId === strategy.id ? "선택됨" : "이 후킹 선택"}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p>상품 정보를 확인한 뒤 후킹 제안 버튼을 눌러주세요.</p>
      )}
      <div className={styles.actionRow}>
        <button disabled={props.isGenerating} onClick={props.onGenerate} type="button">
          {props.isGenerating ? "후킹 분석 중" : "광고 후킹 3안 만들기"}
        </button>
        {props.strategies.length ? (
          <button
            className={styles.secondaryButton}
            disabled={props.isGenerating}
            onClick={props.onGenerateMore}
            type="button"
          >
            다른 후킹 3안
          </button>
        ) : null}
      </div>
    </section>
  );
}

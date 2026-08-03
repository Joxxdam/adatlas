"use client";

import type { CreativeStrategy } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function StrategySelector(props: {
  strategies: CreativeStrategy[];
  selectedStrategyId: string;
  onSelect: (id: string) => void;
  onGenerate: () => void;
  onGenerateMore: () => void;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>광고 전략 3안</h4>
          <p>
            상품 브리프와 선택한 레퍼런스의 사용 범위를 조합한 방향입니다. 카피 생성 전에 하나를
            선택하세요.
          </p>
        </div>
      </div>
      {props.strategies.length ? (
        <div className={styles.strategyGrid}>
          {props.strategies.map((strategy) => (
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
              <h5>{strategy.title}</h5>
              <p>{strategy.explanation}</p>
              <dl className={styles.strategyMeta}>
                <dt>후킹</dt>
                <dd>{strategy.mainHookAngle}</dd>
                <dt>핵심 소구</dt>
                <dd>{strategy.coreAppealPoint}</dd>
                <dt>비주얼</dt>
                <dd>{strategy.suggestedVisualEmphasis}</dd>
                <dt>주의</dt>
                <dd>{strategy.risk}</dd>
              </dl>
            </label>
          ))}
        </div>
      ) : (
        <p>브리프를 확인한 뒤 전략 제안 버튼을 눌러주세요.</p>
      )}
      <div className={styles.actionRow}>
        <button onClick={props.onGenerate} type="button">
          전략 3안 제안
        </button>
        {props.strategies.length ? (
          <button className={styles.secondaryButton} onClick={props.onGenerateMore} type="button">
            다른 전략 3안
          </button>
        ) : null}
      </div>
    </section>
  );
}

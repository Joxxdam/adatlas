"use client";

import type { CreativeStrategy, GeneratedAdCopy } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function StrategySelector(props: { strategies: CreativeStrategy[]; copies?: GeneratedAdCopy[]; selectedStrategyId: string; onGenerate: () => void; onGenerateMore: () => void; isGenerating?: boolean }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>자동 광고문구 6개</h4>
          <p>상세페이지 근거와 광고 목표를 바탕으로 서로 겹치지 않는 문구를 자동 제작합니다.</p>
        </div>
      </div>
      {props.strategies.length ? (
        <div className={styles.strategyGrid}>
          {props.strategies.slice(0, 6).map((strategy, index) => {
            const copy = props.copies?.[index];
            return (
              <article className={`${styles.strategyCard} ${props.selectedStrategyId === strategy.id ? styles.strategyCardSelected : ""}`} key={strategy.id}>
                <span className={styles.strategyIndex}>문구 {index + 1}</span>
                <h5>{strategy.title}</h5>
                <dl className={styles.strategyMeta}>
                  <div className={`${styles.strategyMetaItem} ${styles.strategyMainCopy}`}>
                    <dt>헤드라인</dt>
                    <dd>{copy?.headline || strategy.headline || strategy.mainCopy}</dd>
                  </div>
                  <div className={styles.strategyMetaItem}>
                    <dt>광고 본문</dt>
                    <dd>{copy?.bodyCopy || strategy.subCopy || strategy.appeal}</dd>
                  </div>
                  <div className={styles.strategyMetaItem}>
                    <dt>강조 문구</dt>
                    <dd>{copy?.highlightCopy || strategy.keyAppeal || strategy.coreAppealPoint}</dd>
                  </div>
                  <div className={styles.strategyMetaItem}>
                    <dt>추천 타겟</dt>
                    <dd>{strategy.audience || strategy.audienceFit}</dd>
                  </div>
                </dl>
                <span className={styles.strategySelectLabel}>{props.selectedStrategyId === strategy.id ? "대표 소재에 자동 적용" : "추가 소재에 자동 반영"}</span>
              </article>
            );
          })}
        </div>
      ) : (
        <p>상품 정보를 확인한 뒤 자동 문구 생성 버튼을 눌러주세요.</p>
      )}
      <div className={styles.actionRow}>
        <button disabled={props.isGenerating} onClick={props.onGenerate} type="button">
          {props.isGenerating ? "광고문구 분석 중" : "광고문구 6개 자동 생성·적용"}
        </button>
        {props.strategies.length ? (
          <button className={styles.secondaryButton} disabled={props.isGenerating} onClick={props.onGenerateMore} type="button">
            새로운 문구 6개 다시 생성
          </button>
        ) : null}
      </div>
    </section>
  );
}

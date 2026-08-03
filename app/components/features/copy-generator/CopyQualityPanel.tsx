"use client";

import type { CopyQualityDimension, CopyQualityReport } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

const dimensionLabels: Record<CopyQualityDimension, string> = {
  specificity: "구체성",
  benefitClarity: "혜택 명확성",
  differentiation: "차별성",
  priceClarity: "가격 명확성",
  targetFit: "타깃 적합성",
  naturalKoreanTone: "한국어 자연스러움",
  overclaimSafety: "과장 위험",
  repetitionSafety: "반복 위험",
};

export function CopyQualityPanel(props: { report: CopyQualityReport; onTighten: () => void }) {
  return (
    <section className={styles.section}>
      <div className={styles.qualityTop}>
        <div className={styles.qualityScore}>{props.report.totalScore}</div>
        <div>
          <h4>한국어 광고 카피 품질</h4>
          <p>생성을 막지는 않지만, 배너에 넣기 전에 확인할 항목을 보여줍니다.</p>
        </div>
      </div>
      <div className={styles.scoreGrid}>
        {(Object.entries(props.report.scores) as Array<[CopyQualityDimension, number]>).map(
          ([key, score]) => (
            <div className={styles.scoreItem} key={key}>
              <span>{dimensionLabels[key]}</span>
              <strong>{score}</strong>
            </div>
          )
        )}
      </div>
      {props.report.findings.length ? (
        <ul className={styles.findingList}>
          {props.report.findings.map((finding) => (
            <li
              className={`${styles.finding} ${finding.severity === "error" ? styles.findingError : ""}`}
              key={finding.id}
            >
              <strong>
                {finding.slot ? `${finding.slot}: ` : ""}
                {finding.message}
              </strong>
              {finding.suggestion ? <div>{finding.suggestion}</div> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>현재 템플릿 기준으로 눈에 띄는 문구 위험이 없습니다.</p>
      )}
      <div className={styles.actionRow}>
        <button className={styles.secondaryButton} onClick={props.onTighten} type="button">
          템플릿 길이에 맞게 축약
        </button>
      </div>
    </section>
  );
}

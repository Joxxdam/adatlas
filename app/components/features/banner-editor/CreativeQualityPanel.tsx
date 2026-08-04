"use client";

import type { CreativeQualityScore } from "../../../lib/creative/types";

const labels: Array<[keyof CreativeQualityScore, string]> = [
  ["hookStrength", "후킹"],
  ["hierarchy", "위계"],
  ["productVisibility", "상품"],
  ["sceneRelevance", "장면"],
  ["textReadability", "가독성"],
  ["compositionBalance", "균형"],
  ["benchmarkSimilarity", "광고 완성도"],
  ["factualSafety", "사실 안전"],
];

export function CreativeQualityPanel({ score }: { score: CreativeQualityScore | null }) {
  if (!score) return null;
  return (
    <details className="creative-quality-panel">
      <summary>
        광고 품질 점검 <strong>{score.overall}점</strong>
      </summary>
      <div className="creative-quality-grid">
        {labels.map(([key, label]) => (
          <span key={key}>
            <b>{label}</b>
            <em>{String(score[key])}</em>
          </span>
        ))}
      </div>
      {score.warnings.length ? (
        <ul>
          {score.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p>필수 품질 항목에서 큰 위험이 발견되지 않았습니다.</p>
      )}
    </details>
  );
}

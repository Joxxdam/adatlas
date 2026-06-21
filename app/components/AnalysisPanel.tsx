import { references } from "../data/mock";

const selected = references[0];
const analysisScores = [
  ["훅", 94],
  ["프레임", 91],
  ["USP", 88],
  ["CTA", 82],
  ["브랜드 적합도", 94],
];

export function AnalysisPanel() {
  return (
    <aside className="analysis-panel" id="AI 분석">
      <div>
        <p className="eyebrow">AI 분석</p>
        <h2>{selected.title}</h2>
      </div>

      <div className="analysis-hero">
        <div>
          <span>종합 점수</span>
          <strong>{selected.aiScore}</strong>
        </div>
        <p>{selected.frames.slice(0, 2).join(" + ")}</p>
      </div>

      <div className="analysis-bars">
        {analysisScores.map(([label, score]) => (
          <div className="analysis-score-row" key={label}>
            <span>{label}</span>
            <div>
              <i style={{ width: `${score}%` }} />
            </div>
            <b>{score}</b>
          </div>
        ))}
      </div>

      <div className="visual-script">
        <div>
          <b>01</b>
          <span>문제 제기</span>
        </div>
        <div>
          <b>02</b>
          <span>사용 장면</span>
        </div>
        <div>
          <b>03</b>
          <span>숫자 증명</span>
        </div>
        <div>
          <b>04</b>
          <span>구매 유도</span>
        </div>
      </div>

      <div className="analysis-block highlight">
        <span>핵심 훅</span>
        <p>{selected.hook}</p>
      </div>

      <div className="tag-row">
        {["시원함", "숫자 증명", "후기형", "여름", "릴스 전환"].map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </aside>
  );
}

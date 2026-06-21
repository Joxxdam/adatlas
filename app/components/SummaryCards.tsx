import { summaryCards } from "../data/mock";

const accents = ["수집", "주간", "분석", "추천"];
const progress = [86, 72, 90, 64];

export function SummaryCards() {
  return (
    <section className="summary-grid" aria-label="오늘 요약">
      {summaryCards.map((card, index) => (
        <article className="summary-card visual-card" key={card.label}>
          <div className="summary-topline">
            <span>{card.label}</span>
            <b>{accents[index]}</b>
          </div>
          <strong>{card.value}</strong>
          <div className="mini-progress" aria-label={`${card.label} 진행률`}>
            <i style={{ width: `${progress[index]}%` }} />
          </div>
          <small>{card.detail}</small>
        </article>
      ))}
    </section>
  );
}

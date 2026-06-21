import { trendNotes } from "../data/mock";

const trendStrength = [92, 84, 79, 66];

export function TrendCard() {
  return (
    <section className="panel trend-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">오늘의 트렌드</p>
          <h2>AI가 감지한 상승 패턴</h2>
        </div>
        <span>오늘 업데이트</span>
      </div>
      <div className="trend-visual-list">
        {trendNotes.map((trend, index) => (
          <div className="trend-visual-row" key={trend}>
            <b>{index + 1}</b>
            <span>{trend}</span>
            <div>
              <i style={{ width: `${trendStrength[index]}%` }} />
            </div>
            <em>{trendStrength[index]}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

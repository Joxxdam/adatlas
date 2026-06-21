import { dailyBrief } from "../data/mock";

export function DailyBriefPreview() {
  return (
    <section className="daily-brief" id="데일리 브리프">
      <div>
        <p className="eyebrow">데일리 마케팅 브리프</p>
        <h2>오늘 바로 실행할 액션</h2>
      </div>
      <div className="brief-grid">
        <div>
          <h3>오늘 새로 수집</h3>
          {dailyBrief.newReferences.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <h3>핵심 트렌드</h3>
          {dailyBrief.trends.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <h3>바로 실행할 액션</h3>
          {dailyBrief.actions.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

import { crawlSources } from "../data/mock";

export function CrawlSourceSummary() {
  return (
    <section className="panel" id="트렌드">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">자동 수집 관리</p>
          <h2>API 소스 요약</h2>
        </div>
        <span>매일 오전 9시 실행</span>
      </div>
      <div className="crawl-grid">
        {crawlSources.map((source) => (
          <article key={source.name}>
            <div>
              <span>Tier S</span>
              <b>{source.status}</b>
            </div>
            <h3>{source.name}</h3>
            <p>{source.data}</p>
            <small>기간 선택 수집 지원</small>
            <button type="button">설정 확인</button>
          </article>
        ))}
      </div>
    </section>
  );
}

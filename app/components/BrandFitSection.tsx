import { references } from "../data/mock";

export function BrandFitSection() {
  return (
    <section className="panel" id="브랜드 적합도">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">브랜드 적합도 점수</p>
          <h2>레퍼런스를 우리 브랜드에 맞게 해석</h2>
        </div>
        <button type="button">브랜드 메모리 관리</button>
      </div>
      <div className="fit-list">
        {references.map((reference) => {
          const best = [...reference.compatibility].sort((a, b) => b.score - a.score)[0];
          return (
            <article key={reference.id}>
              <strong>{reference.title}</strong>
              <div>
                {reference.compatibility.map((item) => (
                  <span key={item.brandName}>
                    {item.brandName}
                    <b>{item.score}</b>
                  </span>
                ))}
              </div>
              <p>{best.reason}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

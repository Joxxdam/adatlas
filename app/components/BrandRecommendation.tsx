const brands = [
  { name: "Original Source", score: 94, frames: "UGC + 쿨링 USP", tags: ["뷰티", "여름", "릴스"] },
  { name: "Storynine", score: 96, frames: "시즌 + 코디 제안", tags: ["패션", "장마", "캐러셀"] },
  { name: "Kookdae Hanwoo", score: 95, frames: "가격 + 긴급성", tags: ["식품", "특가", "배너"] },
];

export function BrandRecommendation() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">브랜드별 추천</p>
          <h2>오늘 바로 참고할 광고</h2>
        </div>
        <span>콘텐츠 생성 준비</span>
      </div>
      <div className="brand-reco-grid">
        {brands.map((brand) => (
          <article className="brand-reco-card visual-card" key={brand.name}>
            <div className="brand-reco-head">
              <strong>{brand.name}</strong>
              <span>{brand.score}</span>
            </div>
            <div className="score-bar">
              <i style={{ width: `${brand.score}%` }} />
            </div>
            <p>{brand.frames}</p>
            <div className="board-row">
              {brand.tags.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <button type="button">콘텐츠 생성</button>
          </article>
        ))}
      </div>
    </section>
  );
}

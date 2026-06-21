import { references } from "../data/mock";

export function ReferenceGrid() {
  return (
    <section className="reference-section" id="레퍼런스 보드">
      <div className="section-title">
        <div>
          <p className="eyebrow">레퍼런스 보드</p>
          <h2>시각 중심 광고 카드</h2>
        </div>
        <button type="button">AI 추천 보드 보기</button>
      </div>
      <div className="reference-grid">
        {references.map((reference, index) => {
          const bestFit = [...reference.compatibility].sort((a, b) => b.score - a.score)[0];

          return (
            <article className="reference-card visual-reference" key={reference.id}>
              <div className={`reference-thumb thumb-${(index % 4) + 1}`}>
                <div className="thumb-overlay">
                  <span>{reference.platform}</span>
                  <strong>{reference.thumbnailLabel}</strong>
                </div>
                <div className="media-badge">{reference.mediaTypeLabel}</div>
                <div className="palette">
                  {reference.palette.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </div>
              </div>

              <div className="reference-body compact">
                <div className="reference-meta">
                  <div>
                    <h3>{reference.title}</h3>
                    <p>
                      {reference.brand} / {reference.industry}
                    </p>
                  </div>
                  <strong>{reference.aiScore}</strong>
                </div>

                <p className="hook">&quot;{reference.hook}&quot;</p>

                <div className="fit-meter">
                  <div>
                    <span>최적 브랜드</span>
                    <b>{bestFit.brandName}</b>
                  </div>
                  <div className="score-bar">
                    <i style={{ width: `${bestFit.score}%` }} />
                  </div>
                  <em>{bestFit.score}점</em>
                </div>

                <div className="tag-row">
                  {reference.frames.slice(0, 2).map((frame) => (
                    <span key={frame}>{frame}</span>
                  ))}
                </div>

                <div className="board-row">
                  {reference.boards.slice(0, 3).map((board) => (
                    <span key={board}>{board}</span>
                  ))}
                </div>

                <div className="action-row icon-actions">
                  {["분석", "보드", "저장"].map((action) => (
                    <button key={action} type="button">
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ContentAnalysis, WatchlistBrand } from "../lib/watchlist/types";
import type { MetaAdCard, MetaCrawlResult } from "../lib/meta-crawler/types";

type Props = {
  brands: WatchlistBrand[];
  analyses: ContentAnalysis[];
};

type CrawlState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const sourceLabel: Record<string, string> = {
  watchlist: "워치리스트 메모",
  meta: "Meta 검색 URL",
  google: "Google 광고 투명성",
  tiktok: "TikTok",
  website: "브랜드 사이트",
};

function hasMedia(item: ContentAnalysis) {
  return item.mediaUrls && item.mediaUrls.length > 0;
}

function adMediaUrl(ad: MetaAdCard) {
  return ad.imageUrl ?? ad.videoThumbnailUrl;
}

export function WatchlistExplorer({ brands, analyses }: Props) {
  const brandsWithAnalysis = useMemo(() => {
    const analyzedBrandIds = new Set(analyses.map((item) => item.brandId));
    return brands.filter((brand) => analyzedBrandIds.has(brand.id));
  }, [brands, analyses]);
  const [selectedBrandId, setSelectedBrandId] = useState(
    brandsWithAnalysis[0]?.id ?? brands[0]?.id ?? ""
  );
  const [source, setSource] = useState("all");
  const [limit, setLimit] = useState(20);
  const [crawlState, setCrawlState] = useState<CrawlState>({
    status: "idle",
    message: "브랜드를 선택한 뒤 Meta Ad Library를 서버에서 크롤링합니다.",
  });
  const [metaResult, setMetaResult] = useState<MetaCrawlResult | null>(null);

  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId);
  const filtered = analyses.filter((item) => {
    const brandMatched = item.brandId === selectedBrandId;
    const sourceMatched = source === "all" || item.source === source;
    return brandMatched && sourceMatched;
  });
  const mediaCount = filtered.filter(hasMedia).length;

  const sourceCounts = analyses
    .filter((item) => item.brandId === selectedBrandId)
    .reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] ?? 0) + 1;
      return acc;
    }, {});

  async function handleMetaCrawl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBrand?.urls.meta) {
      setCrawlState({
        status: "error",
        message: "선택한 브랜드에 Meta Ad Library URL이 없습니다.",
      });
      return;
    }

    setCrawlState({
      status: "loading",
      message: "Playwright 브라우저로 Meta Ad Library를 여는 중입니다.",
    });
    setMetaResult(null);

    try {
      const response = await fetch("/api/crawl/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: selectedBrand.brand,
          metaLibraryUrl: selectedBrand.urls.meta,
          limit,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Meta 크롤링에 실패했습니다.");
      }

      setMetaResult(result);
      setCrawlState({
        status: "success",
        message: `${result.brandName} 광고 카드 ${result.count}개를 가져왔습니다. 저장 전 API 응답으로만 표시합니다.`,
      });
    } catch (error) {
      setCrawlState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Meta 크롤링 중 알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  return (
    <div className="explorer-layout">
      <aside className="brand-browser">
        <div className="browser-head">
          <span>브랜드 Watchlist</span>
          <strong>{brands.length}개</strong>
        </div>
        <div className="brand-list">
          {brands.map((brand) => (
            <button
              className={brand.id === selectedBrandId ? "active" : ""}
              key={brand.id}
              type="button"
              onClick={() => {
                setSelectedBrandId(brand.id);
                setMetaResult(null);
                setCrawlState({
                  status: "idle",
                  message: "브랜드를 선택한 뒤 Meta Ad Library를 서버에서 크롤링합니다.",
                });
              }}
            >
              <span>{brand.brand}</span>
              <small>{brand.category}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="content-viewer">
        <div className="viewer-hero">
          <div>
            <p className="eyebrow">Meta Playwright Crawler</p>
            <h1>{selectedBrand?.brand ?? "브랜드를 선택하세요"}</h1>
            <p>{selectedBrand?.referenceStrength}</p>
          </div>
          <div className="viewer-stats">
            <article>
              <span>기존 분석</span>
              <strong>{filtered.length}</strong>
            </article>
            <article>
              <span>기존 이미지</span>
              <strong>{mediaCount}</strong>
            </article>
            <article>
              <span>대표 패턴</span>
              <strong>{selectedBrand?.hookPattern ?? "-"}</strong>
            </article>
          </div>
        </div>

        <form className="meta-crawl-panel" onSubmit={handleMetaCrawl}>
          <div>
            <span>Meta Ad Library URL</span>
            <p>{selectedBrand?.urls.meta ?? "URL 없음"}</p>
          </div>
          <label>
            수집 개수
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              <option value={5}>5개 테스트</option>
              <option value={10}>10개</option>
              <option value={20}>20개 기본</option>
            </select>
          </label>
          <button disabled={crawlState.status === "loading"} type="submit">
            {crawlState.status === "loading" ? "크롤링 중" : "Meta 크롤링 실행"}
          </button>
          <div className={`collection-status ${crawlState.status}`}>{crawlState.message}</div>
        </form>

        {metaResult ? (
          <section className="meta-result-section">
            <div className="section-title compact-title">
              <div>
                <p className="eyebrow">API 응답 JSON 미리보기</p>
                <h2>Meta 광고 카드 {metaResult.count}개</h2>
              </div>
              <span>{new Date(metaResult.crawledAt).toLocaleString("ko-KR")}</span>
            </div>

            {metaResult.warnings.length ? (
              <div className="crawler-warning">{metaResult.warnings.slice(0, 3).join(" / ")}</div>
            ) : null}

            <div className="meta-ad-grid">
              {metaResult.ads.map((ad, index) => {
                const media = adMediaUrl(ad);
                return (
                  <article
                    className="meta-ad-card"
                    key={ad.adSnapshotUrl ?? `${ad.adText}-${index}`}
                  >
                    <div className={media ? "meta-ad-media" : "meta-ad-media empty"}>
                      {media ? (
                        <img alt={`${ad.brandName} Meta 광고 ${index + 1}`} src={media} />
                      ) : (
                        <span>소재 이미지 미수집</span>
                      )}
                    </div>
                    <div className="meta-ad-body">
                      <div>
                        <span>{ad.startedAt ?? "시작일 미확인"}</span>
                        <strong>{ad.brandName}</strong>
                      </div>
                      <p>{ad.adText || "광고 문구를 추출하지 못했습니다."}</p>
                      <div className="meta-ad-links">
                        {ad.adSnapshotUrl ? (
                          <a href={ad.adSnapshotUrl} rel="noreferrer" target="_blank">
                            스냅샷
                          </a>
                        ) : null}
                        {ad.landingUrl ? (
                          <a href={ad.landingUrl} rel="noreferrer" target="_blank">
                            랜딩
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <details className="raw-content">
              <summary>응답 JSON 보기</summary>
              <pre>{JSON.stringify(metaResult, null, 2)}</pre>
            </details>
          </section>
        ) : null}

        <div className="source-tabs">
          <button
            className={source === "all" ? "active" : ""}
            type="button"
            onClick={() => setSource("all")}
          >
            기존 분석 전체
          </button>
          {Object.entries(sourceCounts).map(([key, count]) => (
            <button
              className={source === key ? "active" : ""}
              key={key}
              type="button"
              onClick={() => setSource(key)}
            >
              {sourceLabel[key] ?? key} {count}
            </button>
          ))}
        </div>

        {filtered.length ? (
          <div className="content-analysis-grid">
            {filtered.map((item) => (
              <article className="content-analysis-card" key={item.id}>
                <div className={hasMedia(item) ? "creative-preview" : "creative-preview empty"}>
                  {hasMedia(item) ? (
                    item.mediaUrls.slice(0, 4).map((url, index) => (
                      <a href={url} key={url} rel="noreferrer" target="_blank">
                        <img alt={`${item.brand} 수집 이미지 ${index + 1}`} src={url} />
                      </a>
                    ))
                  ) : (
                    <div>
                      <span>이미지 미수집</span>
                      <strong>{item.brand}</strong>
                      <p>{item.hook}</p>
                    </div>
                  )}
                </div>

                <div className="content-card-head">
                  <div>
                    <span>{sourceLabel[item.source] ?? item.source}</span>
                    <h2>{item.hook}</h2>
                  </div>
                  <strong>{item.copyScore}</strong>
                </div>

                <div className="content-score-row">
                  <span>USP {item.uspScore}</span>
                  <span>Trend {item.trendScore}</span>
                  <span>{item.contentType}</span>
                </div>

                <div className="content-field">
                  <b>USP</b>
                  <div className="tag-row">
                    {item.usp.slice(0, 5).map((usp) => (
                      <span key={usp}>{usp}</span>
                    ))}
                  </div>
                </div>

                <div className="content-field">
                  <b>프레임</b>
                  <div className="tag-row">
                    {item.frames.map((frame) => (
                      <span key={frame}>{frame}</span>
                    ))}
                  </div>
                </div>

                <div className="content-field">
                  <b>CTA</b>
                  <p>{item.cta.join(" / ")}</p>
                </div>

                <details className="raw-content">
                  <summary>크롤링 원문 보기</summary>
                  <p>{item.rawText}</p>
                </details>

                {item.sourceUrl ? (
                  <a className="source-link" href={item.sourceUrl} rel="noreferrer" target="_blank">
                    원본 URL 열기
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-reference-state">
            <h2>아직 이 브랜드의 기존 분석이 없습니다.</h2>
            <p>위의 Meta 크롤링을 실행하면 저장 전 응답 결과를 바로 확인할 수 있습니다.</p>
          </div>
        )}
      </section>
    </div>
  );
}

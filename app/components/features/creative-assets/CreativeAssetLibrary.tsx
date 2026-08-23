"use client";

import { useEffect, useState } from "react";
import type { CreativeAsset } from "../../../lib/creative-assets/types";
import { CreativeAssetActions } from "./CreativeAssetActions";

const statusLabels: Record<CreativeAsset["status"], string> = {
  draft: "초안",
  generated: "생성 완료",
  exported: "다운로드됨",
  running: "집행 중",
  performance_linked: "성과 연결됨",
  learning_completed: "학습 완료",
};

type Filters = {
  assetCode: string;
  brand: string;
  product: string;
  hook: string;
  dateFrom: string;
  dateTo: string;
};

const emptyFilters: Filters = {
  assetCode: "",
  brand: "",
  product: "",
  hook: "",
  dateFrom: "",
  dateTo: "",
};

export function CreativeAssetLibrary() {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [message, setMessage] = useState("생성된 소재 기록을 불러오고 있습니다.");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    void fetch(`/api/creative-assets?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { assets?: CreativeAsset[]; error?: string };
        if (!response.ok || !payload.assets) throw new Error(payload.error || "소재 기록 조회에 실패했습니다.");
        if (!active) return;
        setAssets(payload.assets);
        setMessage(payload.assets.length ? `조건에 맞는 소재 ${payload.assets.length}개` : "조건에 맞는 소재가 없습니다.");
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "소재 기록 조회에 실패했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applied]);

  function update(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="creative-asset-library">
      <div className="creative-asset-library-head">
        <div>
          <p className="eyebrow">CREATIVE ASSETS</p>
          <h4>생성된 소재</h4>
          <span>{message}</span>
        </div>
        <button
          onClick={() => {
            setFilters(emptyFilters);
            setLoading(true);
            setApplied({ ...emptyFilters });
          }}
          type="button"
        >
          검색 초기화
        </button>
      </div>
      <form
        className="creative-asset-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setLoading(true);
          setApplied({ ...filters });
        }}
      >
        <input aria-label="소재코드" onChange={(event) => update("assetCode", event.target.value)} placeholder="소재코드" value={filters.assetCode} />
        <input aria-label="브랜드" onChange={(event) => update("brand", event.target.value)} placeholder="브랜드" value={filters.brand} />
        <input aria-label="상품" onChange={(event) => update("product", event.target.value)} placeholder="상품" value={filters.product} />
        <input aria-label="소구점" onChange={(event) => update("hook", event.target.value)} placeholder="소구점" value={filters.hook} />
        <label>
          <span>시작일</span>
          <input onChange={(event) => update("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
        </label>
        <label>
          <span>종료일</span>
          <input onChange={(event) => update("dateTo", event.target.value)} type="date" value={filters.dateTo} />
        </label>
        <button type="submit">검색</button>
      </form>
      {loading ? <p className="creative-asset-empty">소재 기록을 불러오고 있습니다.</p> : null}
      {!loading && assets.length ? (
        <div className="creative-asset-list">
          {assets.map((asset) => (
            <article key={asset.id}>
              {/* Runtime-generated local files intentionally bypass Next image optimization. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`${asset.productName} 소재`} src={asset.generatedImageUrl} />
              <div className="creative-asset-list-content">
                <div>
                  <strong>{asset.productName}</strong>
                  <span>
                    {asset.brandName} · {asset.category}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>생성일</dt>
                    <dd>{new Date(asset.createdAt).toLocaleString("ko-KR")}</dd>
                  </div>
                  <div>
                    <dt>상태</dt>
                    <dd>{statusLabels[asset.status]}</dd>
                  </div>
                </dl>
                <CreativeAssetActions asset={asset} compact onMessage={setMessage} />
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!loading && !assets.length ? <p className="creative-asset-empty">아직 저장된 최종 소재가 없습니다.</p> : null}
    </section>
  );
}

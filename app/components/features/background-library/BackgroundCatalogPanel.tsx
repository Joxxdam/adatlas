"use client";

/* eslint-disable @next/next/no-img-element -- Catalog and Pexels previews require their exact source URLs. */

import { useEffect, useMemo, useRef, useState } from "react";

import type { BackgroundCatalogItem, BackgroundCatalogSummary, BackgroundCollectionConfig, PexelsSearchPhoto } from "../../../lib/background-library/catalogTypes";
import type { BackgroundLibraryItem, BackgroundRecommendation } from "../../../lib/background-library/types";
import type { CreativeStrategy, ProductInfoForPrompt } from "../../../lib/mvp/types";

import styles from "./BackgroundCatalogPanel.module.css";

type TabId = "recommended" | "owned" | "pexels" | "solid" | "generated" | "upload";
type CatalogItemView = BackgroundCatalogItem & {
  previewUrl: string;
  thumbnailUrl: string;
  background: BackgroundLibraryItem;
};
type CatalogCard = {
  key: string;
  image: string;
  title: string;
  badges: string[];
  onSelect: () => void;
  selected: boolean;
  item?: CatalogItemView;
};

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "recommended", label: "AI 추천" },
  { id: "owned", label: "실사·보유 배경" },
  { id: "pexels", label: "Pexels 검색" },
  { id: "solid", label: "단색·그라데이션" },
  { id: "generated", label: "로컬 생성 배경" },
  { id: "upload", label: "직접 업로드" },
];

const fixedBackgrounds = [
  { id: "mint-soft", label: "민트 소프트", css: "linear-gradient(145deg,#e9fff8,#9cebd4)", colors: ["#e9fff8", "#9cebd4"] },
  { id: "premium-dark", label: "프리미엄 다크", css: "linear-gradient(145deg,#111315,#3a2b23)", colors: ["#111315", "#3a2b23"] },
  { id: "warm-cream", label: "웜 크림", css: "linear-gradient(145deg,#fff8e8,#f1c88b)", colors: ["#fff8e8", "#f1c88b"] },
  { id: "romantic-pink", label: "로맨틱 핑크", css: "linear-gradient(145deg,#fff4f7,#efb9ca)", colors: ["#fff4f7", "#efb9ca"] },
  { id: "fresh-green", label: "내추럴 그린", css: "linear-gradient(145deg,#eef5df,#8fb06f)", colors: ["#eef5df", "#8fb06f"] },
  { id: "clean-white", label: "클린 화이트", css: "#f7f7f4", colors: ["#f7f7f4", "#f7f7f4"] },
];

function fixedDataUrl(colors: string[]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="1600" height="1600" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${window.btoa(svg)}`;
}

function recommendationFromItem(item: CatalogItemView): BackgroundRecommendation {
  return {
    background: item.background,
    score: item.adCompositionScore * 100,
    matchScore: item.backgroundSuitabilityScore * 100,
    diversityScore: 0,
    reasons: [item.recommendedProductPosition.includes("right") ? "상품을 오른쪽에 배치할 여백이 넓어요." : "상품 배치 여백을 분석한 배경이에요.", item.overlayReadability >= 0.6 ? "문구 가독성이 좋아요." : "오버레이를 적용하면 문구가 잘 보여요."],
    connectionLabel: item.sourceType === "pexels" ? "Pexels" : item.sourceType === "local-generation" ? "로컬 생성" : "보유 배경",
    automaticLayout: item.background.recommendedLayouts?.[0] || "product-grounded",
  };
}

export function BackgroundCatalogPanel(props: { product: Partial<ProductInfoForPrompt>; hook: CreativeStrategy; selectedBackgroundSource: string; onSelectBackground: (recommendation: BackgroundRecommendation) => void; onSelectFixedBackground: (source: string, label: string) => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("recommended");
  const [items, setItems] = useState<CatalogItemView[]>([]);
  const [recommendations, setRecommendations] = useState<BackgroundRecommendation[]>([]);
  const [summary, setSummary] = useState<BackgroundCatalogSummary | null>(null);
  const [configs, setConfigs] = useState<BackgroundCollectionConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ collection: "", category: "", scene: "", mood: "", color: "", brightness: "", people: "all", negativeSpace: "", indoorOutdoor: "", license: "", source: "", search: "", sort: "recommended", favorite: false });
  const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsSearchPhoto[]>([]);
  const [pexelsAvailable, setPexelsAvailable] = useState(false);
  const [comfyStatus, setComfyStatus] = useState<{ available: boolean; workflowValid: boolean; workflowError?: string } | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [licenseForm, setLicenseForm] = useState({ sourceName: "광고주 제공", licenseType: "", licenseUrl: "", proofPath: "", commercial: false, reviewed: false });

  const selectedConfig = useMemo(() => configs.find((config) => config.id === filters.collection) || configs[0], [configs, filters.collection]);
  const categories = Object.keys(selectedConfig?.categories || {});

  async function loadCatalog(nextPage = page, source?: "local-generation") {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "24", sort: filters.sort });
      if (filters.collection) params.set("collection", filters.collection);
      if (filters.category) params.set("category", filters.category);
      if (filters.scene) params.set("scene", filters.scene);
      if (filters.mood) params.set("mood", filters.mood);
      if (filters.color) params.set("color", filters.color);
      if (filters.brightness) params.set("brightness", filters.brightness);
      if (filters.people && filters.people !== "all") params.set("people", filters.people);
      if (filters.negativeSpace) params.set("negativeSpace", filters.negativeSpace);
      if (filters.indoorOutdoor) params.set("indoorOutdoor", filters.indoorOutdoor);
      if (filters.license) params.set("license", filters.license);
      if (filters.source) params.set("source", filters.source);
      if (filters.favorite) params.set("favorite", "true");
      if (filters.search) params.set("search", filters.search);
      if (source) params.set("source", source);
      const response = await fetch(`/api/background-library/catalog?${params}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "배경 목록을 불러오지 못했습니다.");
      setItems(result.items || []);
      setSummary(result.summary || null);
      setConfigs(result.configs || []);
      setPage(result.page || 1);
      setTotalPages(result.totalPages || 1);
      setMessage(result.total ? `${result.total}개 중 ${result.items.length}개를 표시합니다.` : "조건에 맞는 저장 배경이 없습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "배경 목록 오류");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecommendations() {
    setLoading(true);
    try {
      const response = await fetch("/api/background-library/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product: props.product, hook: props.hook, limit: 12 }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "추천 실패");
      setRecommendations(result.recommendations || []);
      setSummary(result.summary || null);
      setConfigs(result.configs || []);
      setMessage(result.recommendations?.length ? "비용 없이 상품·후킹·여백 점수로 추천했습니다." : "승인되고 라이선스가 확인된 신규 배경이 없습니다. 기존 추천 배경은 위에서 계속 사용할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추천 오류");
    } finally {
      setLoading(false);
    }
  }

  const loadCatalogRef = useRef(loadCatalog);
  const loadRecommendationsRef = useRef(loadRecommendations);

  useEffect(() => {
    loadCatalogRef.current = loadCatalog;
    loadRecommendationsRef.current = loadRecommendations;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (activeTab === "recommended") void loadRecommendationsRef.current();
      else if (activeTab === "owned") void loadCatalogRef.current(1);
      else if (activeTab === "generated") {
        void loadCatalogRef.current(1, "local-generation");
        void fetch("/api/background-library/comfyui")
          .then((response) => response.json())
          .then((result) => setComfyStatus(result.status || null))
          .catch(() => setComfyStatus({ available: false, workflowValid: false }));
      } else if (activeTab === "pexels") {
        void fetch("/api/background-library/pexels")
          .then((response) => response.json())
          .then((result) => setPexelsAvailable(Boolean(result.status?.available)))
          .catch(() => setPexelsAvailable(false));
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // Product and hook changes intentionally refresh recommendations without resetting selected assets.
  }, [activeTab, props.product.productName, props.hook.id]);

  async function searchPexelsPhotos() {
    if (!pexelsQuery.trim()) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/background-library/pexels?query=${encodeURIComponent(pexelsQuery)}&perPage=24`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Pexels 검색 실패");
      setPexelsPhotos(result.photos || []);
      setMessage(`Photos provided by Pexels · ${result.photos?.length || 0}개 검색`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pexels 검색 오류");
    } finally {
      setLoading(false);
    }
  }

  async function savePexels(photo: PexelsSearchPhoto) {
    if (!selectedConfig || !filters.category) {
      setMessage("저장할 컬렉션과 카테고리를 먼저 선택해주세요.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/background-library/pexels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-selected", photo, collectionId: selectedConfig.id, categoryId: filters.category, matchedQuery: pexelsQuery }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Pexels 저장 실패");
      setMessage("선택한 사진만 저장했습니다. 인물·로고 권리를 검수한 뒤 승인해주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pexels 저장 오류");
    } finally {
      setLoading(false);
    }
  }

  async function uploadBackground() {
    if (!uploadFile || !selectedConfig || !filters.category) {
      setMessage("파일·컬렉션·카테고리를 선택해주세요.");
      return;
    }
    const form = new FormData();
    form.set("file", uploadFile);
    form.set("collectionId", selectedConfig.id);
    form.set("categoryId", filters.category);
    form.set(
      "license",
      JSON.stringify({
        sourceName: licenseForm.sourceName,
        licenseType: licenseForm.licenseType,
        licenseUrl: licenseForm.licenseUrl,
        proofPath: licenseForm.proofPath,
        commercialUseAllowed: licenseForm.commercial,
        licenseStatus: licenseForm.commercial && licenseForm.licenseType && licenseForm.licenseUrl && licenseForm.proofPath ? "verified" : "unverified",
        manuallyReviewed: licenseForm.reviewed,
      })
    );
    setLoading(true);
    try {
      const response = await fetch("/api/background-library/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "업로드 실패");
      setMessage(`가져오기 완료: 승인 ${result.result.approved} · 검수 ${result.result.review} · 제외 ${result.result.rejected}`);
      setUploadFile(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "업로드 오류");
    } finally {
      setLoading(false);
    }
  }

  async function patchItem(item: CatalogItemView, changes: Record<string, unknown>) {
    const response = await fetch("/api/background-library/catalog", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, changes }) });
    if (response.ok) void loadCatalog(page, activeTab === "generated" ? "local-generation" : undefined);
  }

  const cards: CatalogCard[] =
    activeTab === "recommended"
      ? recommendations.map((recommendation) => ({
          key: recommendation.background.id,
          image: recommendation.background.file,
          title: recommendation.background.scene,
          badges: recommendation.reasons,
          onSelect: () => props.onSelectBackground(recommendation),
          selected: props.selectedBackgroundSource === recommendation.background.file,
        }))
      : items.map((item) => ({
          key: item.id,
          image: item.thumbnailUrl,
          title: item.sceneType,
          badges: [item.licenseStatus === "verified" ? "라이선스 확인" : "라이선스 미확인", `합성 ${Math.round(item.adCompositionScore * 100)}점`],
          onSelect: () => (item.status === "approved" && item.licenseStatus === "verified" ? props.onSelectBackground(recommendationFromItem(item)) : setMessage("승인 및 라이선스 확인이 끝난 배경만 광고에 적용할 수 있습니다.")),
          selected: props.selectedBackgroundSource === item.background.file,
          item,
        }));

  return (
    <section className={styles.panel} aria-label="대규모 광고 배경 라이브러리">
      <header className={styles.header}>
        <div>
          <strong>광고 배경 라이브러리</strong>
          <p>유료 생성 없이 보유 이미지·Pexels 선택 저장·로컬 ComfyUI를 사용합니다.</p>
        </div>
        <span>{summary ? `승인 ${summary.productionReady}/${summary.collections.reduce((sum, collection) => sum + collection.targetCount, 0)}` : "불러오는 중"}</span>
      </header>
      <div className={styles.tabs} role="tablist">
        {tabs.map((tab) => (
          <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? styles.activeTab : ""} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button">
            {tab.label}
          </button>
        ))}
      </div>

      {["owned", "pexels", "generated", "upload"].includes(activeTab) ? (
        <div className={styles.filters}>
          <select aria-label="컬렉션" value={filters.collection || selectedConfig?.id || ""} onChange={(event) => setFilters((current) => ({ ...current, collection: event.target.value, category: "" }))}>
            {configs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.displayName}
              </option>
            ))}
          </select>
          <select aria-label="세부 카테고리" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
            <option value="">카테고리 전체</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {activeTab === "owned" ? (
            <>
              <input aria-label="배경 검색" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="장면·분위기 검색" value={filters.search} />
              <select aria-label="밝기" value={filters.brightness} onChange={(event) => setFilters((current) => ({ ...current, brightness: event.target.value }))}>
                <option value="">밝기 전체</option>
                <option value="bright">밝음</option>
                <option value="medium">중간</option>
                <option value="dark">어두움</option>
              </select>
              <select aria-label="인물" value={filters.people} onChange={(event) => setFilters((current) => ({ ...current, people: event.target.value }))}>
                <option value="all">인물 전체</option>
                <option value="none">인물 없음</option>
                <option value="included">인물 포함</option>
              </select>
              <select aria-label="정렬" value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>
                <option value="recommended">추천순</option>
                <option value="latest">최신순</option>
                <option value="shuffle">셔플</option>
              </select>
              <button onClick={() => void loadCatalog(1)} type="button">
                필터 적용
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {activeTab === "owned" ? (
        <details className={styles.advancedFilters}>
          <summary>상세 필터</summary>
          <div>
            <input aria-label="장면" onChange={(event) => setFilters((current) => ({ ...current, scene: event.target.value }))} placeholder="장면 ID" value={filters.scene} />
            <input aria-label="분위기" onChange={(event) => setFilters((current) => ({ ...current, mood: event.target.value }))} placeholder="분위기" value={filters.mood} />
            <input aria-label="주요 색상" onChange={(event) => setFilters((current) => ({ ...current, color: event.target.value }))} placeholder="색상 또는 HEX" value={filters.color} />
            <select aria-label="문구 여백" onChange={(event) => setFilters((current) => ({ ...current, negativeSpace: event.target.value }))} value={filters.negativeSpace}>
              <option value="">여백 전체</option>
              <option value="center-left">왼쪽</option>
              <option value="center-right">오른쪽</option>
              <option value="top-center">위</option>
              <option value="bottom-center">아래</option>
            </select>
            <select aria-label="실내 실외" onChange={(event) => setFilters((current) => ({ ...current, indoorOutdoor: event.target.value }))} value={filters.indoorOutdoor}>
              <option value="">실내·실외 전체</option>
              <option value="indoor">실내</option>
              <option value="outdoor">실외</option>
              <option value="mixed">혼합</option>
            </select>
            <select aria-label="라이선스" onChange={(event) => setFilters((current) => ({ ...current, license: event.target.value }))} value={filters.license}>
              <option value="">라이선스 전체</option>
              <option value="verified">확인 완료</option>
              <option value="unverified">미확인</option>
            </select>
            <select aria-label="출처" onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))} value={filters.source}>
              <option value="">출처 전체</option>
              <option value="local-import">보유 이미지</option>
              <option value="pexels">Pexels</option>
              <option value="local-generation">로컬 생성</option>
            </select>
            <label>
              <input checked={filters.favorite} onChange={(event) => setFilters((current) => ({ ...current, favorite: event.target.checked }))} type="checkbox" /> 즐겨찾기만
            </label>
          </div>
        </details>
      ) : null}

      {activeTab === "pexels" ? (
        <div className={styles.toolArea}>
          <div className={styles.inline}>
            <input disabled={!pexelsAvailable} onChange={(event) => setPexelsQuery(event.target.value)} placeholder="Pexels 영어 검색어" value={pexelsQuery} />
            <button disabled={!pexelsAvailable || loading} onClick={() => void searchPexelsPhotos()} type="button">
              무료 검색
            </button>
          </div>
          {!pexelsAvailable ? <p>PEXELS_API_KEY가 없어 검색만 비활성화됐습니다. 기존 배경 기능은 계속 사용할 수 있습니다.</p> : <p>원본·작가 링크를 보존하며 선택한 사진만 저장합니다. 별도 인물·브랜드 권리를 확인해주세요.</p>}
          <div className={styles.grid}>
            {pexelsPhotos.map((photo) => (
              <article className={styles.card} key={photo.id}>
                <img alt={photo.alt} loading="lazy" src={photo.thumbnailUrl} />
                <strong>{photo.alt || `Pexels #${photo.id}`}</strong>
                <a href={photo.sourcePageUrl} rel="noreferrer" target="_blank">
                  Photo by {photo.photographerName} on Pexels
                </a>
                <button onClick={() => void savePexels(photo)} type="button">
                  광고 배경 후보로 저장
                </button>
              </article>
            ))}
          </div>
          {pexelsPhotos.length ? (
            <a href="https://www.pexels.com/license/" rel="noreferrer" target="_blank">
              Pexels 라이선스 확인
            </a>
          ) : null}
        </div>
      ) : null}

      {activeTab === "solid" ? (
        <div className={styles.grid}>
          {fixedBackgrounds.map((background) => (
            <button className={`${styles.swatch} ${props.selectedBackgroundSource.startsWith("data:image/svg+xml") ? "" : ""}`} key={background.id} onClick={() => props.onSelectFixedBackground(fixedDataUrl(background.colors), background.label)} style={{ background: background.css }} type="button">
              <span>{background.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === "generated" ? (
        <div className={styles.toolArea}>
          <p>{comfyStatus?.available && comfyStatus.workflowValid ? "로컬 ComfyUI 연결 완료" : `로컬 ComfyUI unavailable · ${comfyStatus?.workflowError || "환경변수와 workflow를 설정해주세요."}`}</p>
          <code>npm run backgrounds:comfy:plan -- --collection {selectedConfig?.id || "collection-id"} --dry-run</code>
        </div>
      ) : null}

      {activeTab === "upload" ? (
        <div className={styles.uploadArea}>
          <input accept=".jpg,.jpeg,.png,.webp,.avif,.zip" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} type="file" />
          <input onChange={(event) => setLicenseForm((current) => ({ ...current, licenseType: event.target.value }))} placeholder="권리 또는 라이선스 유형" value={licenseForm.licenseType} />
          <input onChange={(event) => setLicenseForm((current) => ({ ...current, licenseUrl: event.target.value }))} placeholder="라이선스 확인 URL" value={licenseForm.licenseUrl} />
          <input onChange={(event) => setLicenseForm((current) => ({ ...current, proofPath: event.target.value }))} placeholder="계약서·구매증빙 경로 또는 식별자" value={licenseForm.proofPath} />
          <label>
            <input checked={licenseForm.commercial} onChange={(event) => setLicenseForm((current) => ({ ...current, commercial: event.target.checked }))} type="checkbox" /> 상업적 사용 권한을 확인했습니다.
          </label>
          <label>
            <input checked={licenseForm.reviewed} onChange={(event) => setLicenseForm((current) => ({ ...current, reviewed: event.target.checked }))} type="checkbox" /> 인물·로고·문구 위험을 직접 검수했습니다.
          </label>
          <button disabled={loading || !uploadFile || !filters.category} onClick={() => void uploadBackground()} type="button">
            안전하게 가져오기
          </button>
        </div>
      ) : null}

      {["recommended", "owned", "generated"].includes(activeTab) ? (
        <div className={styles.grid} aria-busy={loading}>
          {loading
            ? Array.from({ length: 6 }, (_, index) => <div className={styles.skeleton} key={index} />)
            : cards.map((card) => (
                <article className={`${styles.card} ${card.selected ? styles.selected : ""}`} key={card.key}>
                  <button onClick={card.onSelect} type="button">
                    <img alt={card.title} loading="lazy" src={card.image} />
                    <strong>{card.title}</strong>
                  </button>
                  <div className={styles.badges}>
                    {card.badges.map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                  </div>
                  {card.item ? (
                    <div className={styles.actions}>
                      <button aria-label="즐겨찾기" onClick={() => void patchItem(card.item!, { favorite: !card.item!.favorite })} type="button">
                        {card.item.favorite ? "★" : "☆"}
                      </button>
                      {card.item.status === "review" && card.item.licenseStatus === "verified" ? (
                        <button onClick={() => void patchItem(card.item!, { status: "approved" })} type="button">
                          검수 승인
                        </button>
                      ) : null}
                      <button onClick={() => void patchItem(card.item!, { status: "inactive" })} type="button">
                        사용 제외
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
        </div>
      ) : null}

      {activeTab === "owned" && totalPages > 1 ? (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => void loadCatalog(page - 1)} type="button">
            이전
          </button>
          <span>
            {page}/{totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => void loadCatalog(page + 1)} type="button">
            다음
          </button>
        </div>
      ) : null}
      {summary ? (
        <div className={styles.counts}>
          {summary.collections.map((collection) => (
            <span key={collection.id}>
              {collection.displayName}: {collection.productionReadyCount}/{collection.targetCount} · 부족 {collection.missingCount}
            </span>
          ))}
        </div>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}

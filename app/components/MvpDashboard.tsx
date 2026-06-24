"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdImageAnalysisDraft,
  AdImageLabel,
  CollectedAdImage,
  GeneratedAdImage,
  GeneratedAdCopy,
  MvpBrand,
  ProductInfoForPrompt,
} from "../lib/mvp/types";

type Props = {
  initialBrands: MvpBrand[];
  initialImages: CollectedAdImage[];
  initialGenerated: GeneratedAdImage[];
};

type Status = { kind: "idle" | "loading" | "success" | "error"; message: string };

type MetaCrawlItem = {
  brandName: string;
  imageUrl: string;
  localImagePath?: string;
  originalAdUrl: string;
  collectedAt: string;
};

const categoryOptions = ["식품/선물", "뷰티/스킨케어", "패션/의류", "생활용품", "건강기능식품", "디지털/앱", "인테리어/리빙", "기타"];
const hookTypeOptions = [
  "가격정당화형",
  "가격소구형",
  "문제제기형",
  "공감형",
  "후기/리뷰형",
  "UGC형",
  "비포애프터형",
  "전문가/권위형",
  "선물명분형",
  "긴급/한정형",
  "반전/궁금증형",
  "상황제안형",
];
const appealPointOptions = [
  "가성비",
  "선물명분",
  "고급감",
  "실속",
  "불편해소",
  "체형보완",
  "성분/효능",
  "시간절약",
  "후기신뢰",
  "희소성",
  "즉시혜택",
  "자기관리",
  "사회적 인정",
];

const menus = ["카테고리 관리", "이미지 수집", "이미지 분석", "광고 생성", "결과 다운로드"];

const labelFields: { key: keyof AdImageAnalysisDraft; label: string }[] = [
  { key: "ocrText", label: "이미지 문구" },
  { key: "category", label: "카테고리" },
  { key: "hookType", label: "후킹 방식" },
  { key: "appealPoint", label: "핵심 소구점" },
  { key: "targetEmotion", label: "소비자 감정" },
  { key: "copyNuance", label: "카피 뉘앙스" },
  { key: "visualTone", label: "비주얼 톤" },
  { key: "layoutPattern", label: "레이아웃 구조" },
  { key: "whyItWorks", label: "왜 먹히는지" },
  { key: "recommendedUse", label: "응용 추천" },
];

const emptyDraft: AdImageAnalysisDraft = {
  ocrText: "",
  category: "",
  hookType: "",
  appealPoint: "",
  targetEmotion: "",
  copyNuance: "",
  visualTone: "",
  layoutPattern: "",
  whyItWorks: "",
  recommendedUse: "",
};

const emptyProductInfo: ProductInfoForPrompt = {
  productName: "",
  category: "",
  price: "",
  discountInfo: "",
  mainBenefit: "",
  targetCustomer: "",
  landingUrl: "",
  productImagePath: "",
};

const productFields: { key: keyof ProductInfoForPrompt; label: string; placeholder: string }[] = [
  { key: "productName", label: "productName", placeholder: "예: 큐빅 헤어밴드 세트" },
  { key: "category", label: "category", placeholder: "예: 패션/의류" },
  { key: "price", label: "price", placeholder: "예: 39,900원" },
  { key: "discountInfo", label: "discountInfo", placeholder: "예: 오늘만 20% 할인" },
  { key: "mainBenefit", label: "mainBenefit", placeholder: "예: 선물하기 좋은 고급스러운 구성" },
  { key: "targetCustomer", label: "targetCustomer", placeholder: "예: 부담 없는 선물을 찾는 2030" },
  { key: "landingUrl", label: "landingUrl", placeholder: "https://..." },
  { key: "productImagePath", label: "productImagePath", placeholder: "/collected-images/example.png 또는 https://..." },
];

const emptyBannerCopy: GeneratedAdCopy = {
  headline: "",
  bodyCopy: "",
  highlightCopy: "",
  bottomBarCopy: "",
  cta: "",
  hookType: "",
  appealPoint: "",
  whyThisWorks: "",
};

export function MvpDashboard({ initialBrands, initialGenerated, initialImages }: Props) {
  const [activeMenu, setActiveMenu] = useState(menus[0]);
  const [images, setImages] = useState(initialImages);
  const [generated, setGenerated] = useState(initialGenerated);
  const [labels, setLabels] = useState<AdImageLabel[]>([]);
  const [selectedImage, setSelectedImage] = useState<CollectedAdImage | null>(initialImages[0] ?? null);
  const [aiDraft, setAiDraft] = useState<AdImageAnalysisDraft>(emptyDraft);
  const [finalLabel, setFinalLabel] = useState<AdImageAnalysisDraft>(emptyDraft);
  const [labelStatus, setLabelStatus] = useState<Status>({ kind: "idle", message: "이미지를 선택하면 라벨 편집 패널이 열립니다." });
  const [selectedReferenceLabelIds, setSelectedReferenceLabelIds] = useState<string[]>([]);
  const [productInfo, setProductInfo] = useState<ProductInfoForPrompt>(emptyProductInfo);
  const [strategyStatus, setStrategyStatus] = useState<Status>({ kind: "idle", message: "라벨 완료 레퍼런스 1~3개와 새 상품 정보를 입력하세요." });
  const [copyResult, setCopyResult] = useState<GeneratedAdCopy | null>(null);
  const [copyReferenceLabels, setCopyReferenceLabels] = useState<AdImageLabel[]>([]);
  const [copyStatus, setCopyStatus] = useState<Status>({ kind: "idle", message: "상품 URL을 입력하면 저장된 라벨 데이터를 참고해 광고 문구를 생성합니다." });
  const [bannerCopy, setBannerCopy] = useState<GeneratedAdCopy>(emptyBannerCopy);
  const [generatedBannerPath, setGeneratedBannerPath] = useState("");
  const [renderStatus, setRenderStatus] = useState<Status>({ kind: "idle", message: "문구 생성 후 배너를 만들 수 있습니다." });
  const [crawledItems, setCrawledItems] = useState<MetaCrawlItem[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "MVP 작업을 선택하세요." });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [appealPointFilter, setAppealPointFilter] = useState("all");
  const [hookTypeFilter, setHookTypeFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [labelStateFilter, setLabelStateFilter] = useState("all");

  const labelsByImageId = useMemo(() => new Map(labels.map((label) => [label.imageId, label])), [labels]);
  const selectedReferenceLabels = useMemo(
    () => selectedReferenceLabelIds.map((id) => labelsByImageId.get(id)).filter((label): label is AdImageLabel => Boolean(label)),
    [labelsByImageId, selectedReferenceLabelIds],
  );
  const analyzedImages = images.filter((image) => labelsByImageId.has(image.id));
  const filteredImages = images.filter((image) => {
    const label = labelsByImageId.get(image.id);
    const category = label?.finalLabel.category || image.category || "기타";
    const hookType = label?.finalLabel.hookType || image.hookType || "";
    const appealPoint = label?.finalLabel.appealPoint || image.appealPoint || "";
    const platform = String(image.sourcePlatform || "").toLowerCase();
    const isLabeled = labelsByImageId.has(image.id);

    return (
      (categoryFilter === "all" || category === categoryFilter) &&
      (hookTypeFilter === "all" || hookType === hookTypeFilter) &&
      (appealPointFilter === "all" || appealPoint === appealPointFilter) &&
      (platformFilter === "all" || platform === platformFilter) &&
      (labelStateFilter === "all" || (labelStateFilter === "done" ? isLabeled : !isLabeled))
    );
  });
  const categoryCount = new Set(images.map((image) => labelsByImageId.get(image.id)?.finalLabel.category || image.category).filter(Boolean)).size;
  const hookTypeCount = new Set(images.map((image) => labelsByImageId.get(image.id)?.finalLabel.hookType || image.hookType).filter(Boolean)).size;
  const metrics = [
    ["전체 수집 이미지 수", images.length + crawledItems.length],
    ["라벨 필요 이미지 수", Math.max(0, images.length - analyzedImages.length)],
    ["라벨 완료 이미지 수", analyzedImages.length],
    ["카테고리 수", categoryCount],
    ["후킹 유형 수", hookTypeCount],
  ];

  useEffect(() => {
    refreshImages().catch(() => undefined);
  }, []);

  async function refreshImages() {
    const response = await fetch("/api/mvp/images");
    const result = await response.json();
    setImages(result.images ?? []);
    setGenerated(result.generated ?? []);
    setLabels(result.labels ?? []);
  }

  function openLabelPanel(image: CollectedAdImage) {
    const existing = labelsByImageId.get(image.id);
    setSelectedImage(image);
    setAiDraft(existing?.aiDraft ?? emptyDraft);
    setFinalLabel(existing?.finalLabel ?? {
      ...emptyDraft,
      category: image.category || "",
      hookType: image.hookType || "",
      appealPoint: image.appealPoint || "",
    });
    setActiveMenu("이미지 수집");
    setLabelStatus({
      kind: existing ? "success" : "idle",
      message: existing ? "저장된 라벨을 먼저 불러왔습니다. 다시 호출하려면 재분석하기를 누르세요." : "AI 분석하기를 누르거나 직접 라벨을 입력하세요.",
    });
  }

  async function analyzeImage(image: CollectedAdImage) {
    setSelectedImage(image);
    setLabelStatus({ kind: "loading", message: `${image.category || "광고"} 이미지를 마케터 관점으로 분석 중입니다.` });

    try {
      const response = await fetch("/api/analyze/ad-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: image.id,
          brandName: image.brandName,
          category: image.category,
          imageUrl: image.imageUrl,
          localImagePath: image.localImagePath,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "AI 분석 실패");
      }

      setAiDraft(result.draft);
      setFinalLabel(result.draft);
      setLabelStatus({
        kind: "success",
        message: result.isMock ? "OPENAI_API_KEY가 없어 mock 분석 초안을 만들었습니다." : "AI 분석 초안을 만들었습니다.",
      });
    } catch (error) {
      setLabelStatus({ kind: "error", message: error instanceof Error ? error.message : "AI 분석 중 오류가 발생했습니다." });
    }
  }

  async function saveLabel() {
    if (!selectedImage) {
      setLabelStatus({ kind: "error", message: "라벨을 저장할 이미지를 선택하세요." });
      return;
    }

    setLabelStatus({ kind: "loading", message: "최종 라벨을 저장 중입니다." });

    try {
      const response = await fetch("/api/labels/ad-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: selectedImage.id,
          category: finalLabel.category || selectedImage.category || "기타",
          brandName: selectedImage.brandName,
          sourcePlatform: selectedImage.sourcePlatform.toLowerCase(),
          localImagePath: selectedImage.localImagePath,
          aiDraft,
          finalLabel,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "라벨 저장 실패");
      }

      setLabels(result.labels ?? []);
      setLabelStatus({ kind: "success", message: "라벨을 저장했습니다." });
    } catch (error) {
      setLabelStatus({ kind: "error", message: error instanceof Error ? error.message : "라벨 저장 중 오류가 발생했습니다." });
    }
  }

  async function saveImageMetadata(image: CollectedAdImage, updates: Partial<CollectedAdImage>) {
    setStatus({ kind: "loading", message: "이미지 메타데이터를 저장 중입니다." });

    try {
      const response = await fetch("/api/collected-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: image.id, ...updates }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "이미지 메타데이터 저장 실패");
      }

      setImages(result.images ?? []);
      const updated = (result.images ?? []).find((item: CollectedAdImage) => item.id === image.id);
      if (updated) setSelectedImage(updated);
      setStatus({ kind: "success", message: "이미지 메타데이터를 저장했습니다." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "이미지 메타데이터 저장 중 오류가 발생했습니다." });
    }
  }

  function toggleReferenceSelection(imageId: string) {
    if (!labelsByImageId.has(imageId)) {
      setStrategyStatus({ kind: "error", message: "라벨 완료된 이미지만 레퍼런스로 선택할 수 있습니다." });
      return;
    }

    setSelectedReferenceLabelIds((current) => {
      if (current.includes(imageId)) {
        return current.filter((id) => id !== imageId);
      }
      if (current.length >= 3) {
        setStrategyStatus({ kind: "error", message: "레퍼런스는 최대 3개까지 선택할 수 있습니다." });
        return current;
      }
      return [...current, imageId];
    });
  }

  async function generateBannerCopy() {
    setCopyStatus({ kind: "loading", message: "선택한 라벨 레퍼런스를 참고해 광고문구를 생성 중입니다." });
    setGeneratedBannerPath("");

    try {
      const response = await fetch("/api/strategy/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productInfo, referenceLabels: selectedReferenceLabels }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "광고문구 생성 실패");
      }

      setCopyResult(result.copy);
      setBannerCopy(result.copy);
      setCopyReferenceLabels(result.referenceLabels ?? selectedReferenceLabels);
      setCopyStatus({
        kind: "success",
        message: result.isMock ? "OPENAI_API_KEY가 없어 mock 광고문구를 생성했습니다." : "광고문구를 생성했습니다.",
      });
    } catch (error) {
      setCopyStatus({ kind: "error", message: error instanceof Error ? error.message : "광고문구 생성 중 오류가 발생했습니다." });
    }
  }

  async function renderBanner() {
    setRenderStatus({ kind: "loading", message: "SVG 템플릿을 1200x1200 PNG로 렌더링 중입니다." });

    try {
      const response = await fetch("/api/render/template-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: "bold-commerce-001",
          canvasSize: { width: 1200, height: 1200 },
          copy: {
            headline: bannerCopy.headline,
            bodyCopy: bannerCopy.bodyCopy,
            highlightCopy: bannerCopy.highlightCopy,
            bottomBarCopy: bannerCopy.bottomBarCopy,
            cta: bannerCopy.cta,
            price: productInfo.price,
          },
          productImagePath: productInfo.productImagePath,
          style: {
            backgroundColor: "#ffffff",
            headlineColor: "#e60012",
            highlightBackground: "#fff200",
            bottomBarColor: "#e60012",
            ctaBarColor: "#de6f6f",
          },
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "배너 생성 실패");
      }

      setGeneratedBannerPath(result.imagePath);
      setRenderStatus({ kind: "success", message: "1200x1200 PNG 배너를 생성했습니다." });
    } catch (error) {
      setRenderStatus({ kind: "error", message: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다." });
    }
  }

  return (
    <main className="mvp-shell">
      <aside className="mvp-sidebar">
        <div>
          <p className="eyebrow">AdAtlas MVP</p>
          <h1>광고 이미지 수집 생성기</h1>
        </div>
        <nav>
          {menus.map((menu) => (
            <button className={activeMenu === menu ? "active" : ""} key={menu} onClick={() => setActiveMenu(menu)} type="button">
              {menu}
            </button>
          ))}
        </nav>
      </aside>

      <section className="mvp-workspace">
        <header className="mvp-hero">
          <div>
            <p className="eyebrow">MVP Workflow</p>
            <h2>수집된 광고 이미지를 카테고리, 후킹 유형, 소구점 기준으로 라벨링합니다.</h2>
          </div>
          <div className="mvp-primary-actions">
            <button onClick={() => setActiveMenu("이미지 수집")} type="button">수집 이미지 라벨링</button>
            <button onClick={() => setActiveMenu("이미지 수집")} type="button">수집된 이미지 보기</button>
            <button onClick={() => setActiveMenu("광고 생성")} type="button">광고 이미지 생성하기</button>
          </div>
        </header>

        <section className="mvp-metrics">
          {metrics.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <div className={`mvp-status ${status.kind}`}>{status.message}</div>

        {activeMenu === "카테고리 관리" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>카테고리 관리</h3>
            </div>
            <div className="taxonomy-board">
              <TaxonomyGroup title="카테고리" items={categoryOptions} />
              <TaxonomyGroup title="후킹 유형" items={hookTypeOptions} />
              <TaxonomyGroup title="소구점" items={appealPointOptions} />
            </div>
          </section>
        ) : null}

        {activeMenu === "이미지 수집" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 수집</h3>
              <button onClick={refreshImages} type="button">이미지 새로고침</button>
            </div>
            <FilterBar
              appealPointFilter={appealPointFilter}
              categoryFilter={categoryFilter}
              hookTypeFilter={hookTypeFilter}
              labelStateFilter={labelStateFilter}
              platformFilter={platformFilter}
              setAppealPointFilter={setAppealPointFilter}
              setCategoryFilter={setCategoryFilter}
              setHookTypeFilter={setHookTypeFilter}
              setLabelStateFilter={setLabelStateFilter}
              setPlatformFilter={setPlatformFilter}
            />
            {crawledItems.length ? <CrawledGrid items={crawledItems} /> : null}
            <div className="labeling-workspace">
              <ImageGrid
                images={filteredImages}
                labelsByImageId={labelsByImageId}
                onAnalyze={analyzeImage}
                onMetadataSave={saveImageMetadata}
                onSelect={openLabelPanel}
                onToggleReference={toggleReferenceSelection}
                selectedReferenceIds={selectedReferenceLabelIds}
                selectedImageId={selectedImage?.id}
              />
              <LabelPanel
                aiDraft={aiDraft}
                finalLabel={finalLabel}
                hasExistingLabel={Boolean(selectedImage && labelsByImageId.has(selectedImage.id))}
                image={selectedImage}
                onAnalyze={analyzeImage}
                onDraftChange={setFinalLabel}
                onSave={saveLabel}
                status={labelStatus}
              />
            </div>
          </section>
        ) : null}

        {activeMenu === "이미지 분석" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 분석</h3>
              <span className="panel-note">이미지별 카드에서 AI 분석 또는 재분석을 실행하세요.</span>
            </div>
            <div className="labeling-workspace">
              <ImageGrid
                images={filteredImages}
                labelsByImageId={labelsByImageId}
                onAnalyze={analyzeImage}
                onMetadataSave={saveImageMetadata}
                onSelect={openLabelPanel}
                onToggleReference={toggleReferenceSelection}
                selectedReferenceIds={selectedReferenceLabelIds}
                selectedImageId={selectedImage?.id}
                showAnalysis
              />
              <LabelPanel
                aiDraft={aiDraft}
                finalLabel={finalLabel}
                hasExistingLabel={Boolean(selectedImage && labelsByImageId.has(selectedImage.id))}
                image={selectedImage}
                onAnalyze={analyzeImage}
                onDraftChange={setFinalLabel}
                onSave={saveLabel}
                status={labelStatus}
              />
            </div>
          </section>
        ) : null}

        {activeMenu === "광고 생성" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>Canvas/SVG 광고 배너 생성</h3>
              <span className="panel-note">문구 생성만 OpenAI를 사용할 수 있고, 배너 생성은 SVG 렌더링만 사용합니다.</span>
            </div>

            <div className={`mvp-status ${copyStatus.kind}`}>{copyStatus.message}</div>
            <div className="banner-builder">
              <section className="strategy-reference-panel">
                <p className="eyebrow">Reference Labels</p>
                <h4>선택한 레퍼런스 {selectedReferenceLabels.length}/3</h4>
                {labels.length ? (
                  <div className="strategy-reference-list">
                    {labels.map((label) => (
                      <article className={selectedReferenceLabelIds.includes(label.imageId) ? "selected" : ""} key={label.imageId}>
                        {label.localImagePath ? <img alt={`${label.category || label.brandName} 레퍼런스`} src={label.localImagePath} /> : null}
                        <div>
                          <strong>{label.category || "기타"}</strong>
                          <span>{label.finalLabel.hookType || "후킹 미입력"}</span>
                          <small>{label.finalLabel.appealPoint || "소구점 미입력"}</small>
                          <small>{label.finalLabel.copyNuance || "카피 뉘앙스 미입력"}</small>
                          <label className="inline-check">
                            <input
                              checked={selectedReferenceLabelIds.includes(label.imageId)}
                              onChange={() => toggleReferenceSelection(label.imageId)}
                              type="checkbox"
                            />
                            레퍼런스로 선택
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="strategy-empty">라벨 저장이 완료된 이미지가 없습니다. 먼저 이미지 라벨을 저장해주세요.</p>
                )}
              </section>

              <section className="strategy-form banner-product-form">
                <p className="eyebrow">Product Info</p>
                {productFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <input
                      onChange={(event) => setProductInfo((current) => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={field.placeholder}
                      value={productInfo[field.key] || ""}
                    />
                  </label>
                ))}
                <button disabled={!selectedReferenceLabels.length} onClick={generateBannerCopy} type="button">광고문구 생성</button>
              </section>
            </div>

            <div className="banner-workspace">
              <section className="copy-edit-panel">
                <div>
                  <p className="eyebrow">Editable Copy</p>
                  <h4>생성 문구 수정</h4>
                </div>
                {(["headline", "bodyCopy", "highlightCopy", "bottomBarCopy", "cta"] as const).map((key) => (
                  <label key={key}>
                    <span>{key}</span>
                    <textarea
                      onChange={(event) => setBannerCopy((current) => ({ ...current, [key]: event.target.value }))}
                      rows={key === "headline" ? 2 : 3}
                      value={bannerCopy[key]}
                    />
                  </label>
                ))}
                <label>
                  <span>price</span>
                  <input
                    onChange={(event) => setProductInfo((current) => ({ ...current, price: event.target.value }))}
                    value={productInfo.price}
                  />
                </label>
                {copyResult ? <p className="strategy-empty">{copyResult.whyThisWorks}</p> : null}
                <button disabled={!bannerCopy.headline} onClick={renderBanner} type="button">배너 생성</button>
              </section>

              <section className="banner-preview-panel">
                <div>
                  <p className="eyebrow">PNG Preview</p>
                  <h4>bold-commerce-001</h4>
                </div>
                <div className={`mvp-status ${renderStatus.kind}`}>{renderStatus.message}</div>
                {generatedBannerPath ? (
                  <>
                    <img alt="생성된 광고 배너" src={generatedBannerPath} />
                    <a className="download-button" download href={generatedBannerPath}>PNG 다운로드</a>
                  </>
                ) : (
                  <div className="empty-banner-preview">1200x1200 PNG 미리보기</div>
                )}
              </section>
            </div>
          </section>
        ) : null}

        {activeMenu === "결과 다운로드" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>생성 기록</h3>
            </div>
            <div className="download-list">
              {generated.length ? generated.map((item) => (
                <article key={item.id}>
                  <strong>{item.productName}</strong>
                  <span>{new Date(item.createdAt).toLocaleString("ko-KR")}</span>
                </article>
              )) : <article><strong>아직 저장된 이미지 생성 결과가 없습니다.</strong><span>이번 단계는 전략/카피/프롬프트 생성까지만 제공합니다.</span></article>}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function CrawledGrid({ items }: { items: MetaCrawlItem[] }) {
  return (
    <div className="mvp-image-grid">
      {items.map((item) => (
        <article key={`${item.imageUrl}-${item.originalAdUrl}`}>
          <img alt={`${item.brandName} 수집 광고 이미지`} src={item.localImagePath || item.imageUrl} />
          <div>
            <strong>{item.brandName}</strong>
            <span>{new Date(item.collectedAt).toLocaleString("ko-KR")}</span>
            {item.originalAdUrl ? (
              <a href={item.originalAdUrl} rel="noreferrer" target="_blank">광고 원본 보기</a>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function TaxonomyGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      <div>
        {items.map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  );
}

function FilterBar({
  appealPointFilter,
  categoryFilter,
  hookTypeFilter,
  labelStateFilter,
  platformFilter,
  setAppealPointFilter,
  setCategoryFilter,
  setHookTypeFilter,
  setLabelStateFilter,
  setPlatformFilter,
}: {
  appealPointFilter: string;
  categoryFilter: string;
  hookTypeFilter: string;
  labelStateFilter: string;
  platformFilter: string;
  setAppealPointFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setHookTypeFilter: (value: string) => void;
  setLabelStateFilter: (value: string) => void;
  setPlatformFilter: (value: string) => void;
}) {
  return (
    <div className="taxonomy-filters">
      <label>
        <span>카테고리</span>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">전체</option>
          {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>소구점</span>
        <select value={appealPointFilter} onChange={(event) => setAppealPointFilter(event.target.value)}>
          <option value="all">전체</option>
          {appealPointOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>후킹 유형</span>
        <select value={hookTypeFilter} onChange={(event) => setHookTypeFilter(event.target.value)}>
          <option value="all">전체</option>
          {hookTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>플랫폼</span>
        <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="meta">meta</option>
          <option value="tiktok">tiktok</option>
          <option value="manual">manual</option>
        </select>
      </label>
      <label>
        <span>라벨 상태</span>
        <select value={labelStateFilter} onChange={(event) => setLabelStateFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="needed">라벨 필요</option>
          <option value="done">라벨 완료</option>
        </select>
      </label>
    </div>
  );
}

function ImageGrid({
  images,
  labelsByImageId,
  onAnalyze,
  onMetadataSave,
  onSelect,
  onToggleReference,
  selectedReferenceIds,
  selectedImageId,
  showAnalysis = false,
}: {
  images: CollectedAdImage[];
  labelsByImageId: Map<string, AdImageLabel>;
  onAnalyze: (image: CollectedAdImage) => void;
  onMetadataSave: (image: CollectedAdImage, updates: Partial<CollectedAdImage>) => void;
  onSelect: (image: CollectedAdImage) => void;
  onToggleReference: (imageId: string) => void;
  selectedReferenceIds: string[];
  selectedImageId?: string;
  showAnalysis?: boolean;
}) {
  return (
    <div className="mvp-image-grid">
      {images.map((image) => (
        <article className={selectedImageId === image.id ? "selected" : ""} key={image.id} onClick={() => onSelect(image)}>
          {(() => {
            const existingLabel = labelsByImageId.get(image.id);
            const displayCategory = existingLabel?.finalLabel.category || image.category || "기타";
            const displayHookType = existingLabel?.finalLabel.hookType || image.hookType || "";
            const displayAppealPoint = existingLabel?.finalLabel.appealPoint || image.appealPoint || "";

            return (
              <>
          <div className={`label-badge ${existingLabel ? "done" : "needed"}`}>
            {existingLabel ? "라벨 완료" : "라벨 필요"}
          </div>
          {existingLabel ? (
            <label className="reference-check" onClick={(event) => event.stopPropagation()}>
              <input
                checked={selectedReferenceIds.includes(image.id)}
                onChange={() => onToggleReference(image.id)}
                type="checkbox"
              />
              레퍼런스로 선택
            </label>
          ) : null}
          <img alt={`${image.category || "광고"} 이미지`} src={image.localImagePath || image.imageUrl} />
          <div>
            <strong>{displayCategory}</strong>
            <span>{displayHookType || "후킹 미지정"} / {displayAppealPoint || "소구점 미지정"} / {image.sourcePlatform}</span>
            <div className="metadata-editor" onClick={(event) => event.stopPropagation()}>
              <select
                aria-label="카테고리"
                defaultValue={displayCategory}
                onChange={(event) => onMetadataSave(image, { category: event.target.value })}
              >
                {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select
                aria-label="후킹 유형"
                defaultValue={displayHookType}
                onChange={(event) => onMetadataSave(image, { hookType: event.target.value })}
              >
                <option value="">후킹 유형</option>
                {hookTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select
                aria-label="소구점"
                defaultValue={displayAppealPoint}
                onChange={(event) => onMetadataSave(image, { appealPoint: event.target.value })}
              >
                <option value="">소구점</option>
                {appealPointOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input
                aria-label="브랜드명 optional"
                defaultValue={image.brandName}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== image.brandName) onMetadataSave(image, { brandName: value });
                }}
                placeholder="브랜드명 optional"
              />
              <select
                aria-label="플랫폼"
                defaultValue={String(image.sourcePlatform).toLowerCase()}
                onChange={(event) => onMetadataSave(image, { sourcePlatform: event.target.value as CollectedAdImage["sourcePlatform"] })}
              >
                <option value="meta">meta</option>
                <option value="tiktok">tiktok</option>
                <option value="manual">manual</option>
              </select>
            </div>
            {showAnalysis && existingLabel ? <p>{existingLabel.finalLabel.copyNuance || existingLabel.finalLabel.hookType}</p> : null}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onAnalyze(image);
              }}
              type="button"
            >
              {existingLabel ? "재분석하기" : "AI 분석하기"}
            </button>
          </div>
              </>
            );
          })()}
        </article>
      ))}
    </div>
  );
}

function LabelPanel({
  aiDraft,
  finalLabel,
  hasExistingLabel,
  image,
  onAnalyze,
  onDraftChange,
  onSave,
  status,
}: {
  aiDraft: AdImageAnalysisDraft;
  finalLabel: AdImageAnalysisDraft;
  hasExistingLabel: boolean;
  image: CollectedAdImage | null;
  onAnalyze: (image: CollectedAdImage) => void;
  onDraftChange: (draft: AdImageAnalysisDraft) => void;
  onSave: () => void;
  status: Status;
}) {
  return (
    <aside className="label-panel">
      {image ? (
        <>
          <div className="label-preview">
            <img alt={`${image.category || "광고"} 라벨 편집 이미지`} src={image.localImagePath || image.imageUrl} />
            <div>
              <p className="eyebrow">Ad Image Label</p>
              <h3>{finalLabel.category || image.category || "기타"}</h3>
              <span>{finalLabel.hookType || image.hookType || "후킹 미지정"} / {finalLabel.appealPoint || image.appealPoint || "소구점 미지정"} / {image.sourcePlatform}</span>
            </div>
          </div>
          <div className={`mvp-status ${status.kind}`}>{status.message}</div>
          <div className="label-actions">
            <button onClick={() => onAnalyze(image)} type="button">{hasExistingLabel ? "재분석하기" : "AI 분석하기"}</button>
            <button onClick={onSave} type="button">라벨 저장</button>
          </div>
          <section className="ai-draft-box">
            <h4>AI 분석 초안</h4>
            <p>{aiDraft.whyItWorks || "아직 분석 초안이 없습니다."}</p>
          </section>
          <form className="label-form">
            {labelFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.key === "category" || field.key === "hookType" || field.key === "appealPoint" ? (
                  <select
                    onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })}
                    value={finalLabel[field.key]}
                  >
                    <option value="">선택</option>
                    {(field.key === "category" ? categoryOptions : field.key === "hookType" ? hookTypeOptions : appealPointOptions).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })}
                    rows={field.key === "whyItWorks" || field.key === "recommendedUse" ? 4 : 3}
                    value={finalLabel[field.key]}
                  />
                )}
              </label>
            ))}
          </form>
        </>
      ) : (
        <div className="empty-label-panel">
          <p className="eyebrow">Ad Image Label</p>
          <h3>이미지를 선택하세요</h3>
          <p>이미지 카드에서 AI 분석 초안을 만들고 최종 라벨로 저장할 수 있습니다.</p>
        </div>
      )}
    </aside>
  );
}

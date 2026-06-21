"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { CollectedAdImage, GeneratedAdImage, MvpBrand } from "../lib/mvp/types";

type Props = {
  initialBrands: MvpBrand[];
  initialImages: CollectedAdImage[];
  initialGenerated: GeneratedAdImage[];
};

type Status = { kind: "idle" | "loading" | "success" | "error"; message: string };

type MetaCrawlItem = {
  brandName: string;
  imageUrl: string;
  originalAdUrl: string;
  collectedAt: string;
};

const menus = ["브랜드 관리", "이미지 수집", "이미지 분석", "광고 생성", "결과 다운로드"];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeRows(rows: Record<string, unknown>[]) {
  return rows
    .map((record) => ({
      brandName: String(record.brandName || record.brand || record["브랜드명"] || record["브랜드/업체"] || "").trim(),
      category: String(record.category || record["카테고리"] || "").trim(),
      metaLibraryUrl: String(record.metaLibraryUrl || record.meta || record["Meta Ad Library URL"] || record["Meta Ad Library 검색URL"] || "").trim(),
      tiktokUrl: String(record.tiktokUrl || record.tiktok || record["TikTok URL"] || record["TikTok Creative Center"] || "").trim(),
      enabled: record.enabled === undefined ? true : String(record.enabled) !== "false",
    }))
    .filter((item) => item.brandName);
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(",").map((item) => item.trim());
  return normalizeRows(
    rows.map((line) => {
      const values = line.split(",").map((item) => item.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    }),
  );
}

export function MvpDashboard({ initialBrands, initialGenerated, initialImages }: Props) {
  const [activeMenu, setActiveMenu] = useState(menus[0]);
  const [brands, setBrands] = useState(initialBrands);
  const [images, setImages] = useState(initialImages);
  const [generated, setGenerated] = useState(initialGenerated);
  const [selectedBrandId, setSelectedBrandId] = useState(initialBrands[0]?.id ?? "");
  const [selectedReferenceId, setSelectedReferenceId] = useState(initialImages[0]?.id ?? "");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [crawlLimit, setCrawlLimit] = useState(20);
  const [crawledItems, setCrawledItems] = useState<MetaCrawlItem[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "MVP 작업을 선택하세요." });
  const [generatedPreview, setGeneratedPreview] = useState<{ productName: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) ?? brands[0];
  const todayImages = images.filter((image) => image.collectedAt.startsWith(todayKey()));
  const analyzedImages = images.filter((image) => image.analysis);
  const metrics = [
    ["등록 브랜드 수", brands.length],
    ["오늘 수집 이미지 수", todayImages.length + crawledItems.length],
    ["분석 완료 이미지 수", analyzedImages.length],
    ["생성 이미지 수", generated.length],
  ];

  const collectionStatus = useMemo(() => {
    const enabled = brands.filter((brand) => brand.enabled);
    const completed = new Set(todayImages.map((image) => image.brandName)).size;
    return {
      totalBrands: enabled.length,
      completedBrands: completed,
      collectedImages: todayImages.length,
      failedBrands: Math.max(0, enabled.length - completed),
    };
  }, [brands, todayImages]);

  async function refreshImages() {
    const response = await fetch("/api/mvp/images");
    const result = await response.json();
    setImages(result.images ?? []);
    setGenerated(result.generated ?? []);
  }

  async function saveBrands(nextBrands: MvpBrand[]) {
    setBrands(nextBrands);
    await fetch("/api/mvp/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brands: nextBrands }),
    });
  }

  async function handleCrawl() {
    if (!selectedBrand) {
      setStatus({ kind: "error", message: "수집할 브랜드를 선택하세요." });
      return;
    }
    if (!selectedBrand.metaLibraryUrl) {
      setStatus({ kind: "error", message: "선택한 브랜드에 Meta Ad Library URL이 없습니다." });
      return;
    }

    setActiveMenu("이미지 수집");
    setCrawledItems([]);
    setStatus({ kind: "loading", message: `${selectedBrand.brandName} 광고 이미지를 서버에서 수집 중입니다.` });

    try {
      const response = await fetch("/api/crawl/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: selectedBrand.brandName,
          metaLibraryUrl: selectedBrand.metaLibraryUrl,
          limit: crawlLimit,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Meta 이미지 수집 실패");
      }

      setCrawledItems(result.items ?? []);
      setStatus({ kind: "success", message: `${result.brandName} 이미지 ${result.count}개를 수집했습니다.` });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "수집 중 알 수 없는 오류가 발생했습니다.",
      });
    }
  }

  async function handleCollectAll() {
    setStatus({ kind: "loading", message: "브랜드 100개 기준 이미지 수집을 실행 중입니다. 브랜드당 최대 20개입니다." });
    const response = await fetch("/api/mvp/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandLimit: 100, limitPerBrand: 20 }),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus({ kind: "error", message: result.error ?? "이미지 수집 실패" });
      return;
    }
    await refreshImages();
    setActiveMenu("이미지 수집");
    setStatus({ kind: "success", message: `새 이미지 ${result.added}개 저장, 전체 ${result.totalImages}개입니다.` });
  }

  async function handleAnalyze() {
    setStatus({ kind: "loading", message: "수집 이미지의 텍스트와 후킹 요소를 분석 중입니다." });
    const response = await fetch("/api/mvp/analyze", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setStatus({ kind: "error", message: result.error ?? "이미지 분석 실패" });
      return;
    }
    setImages(result.images ?? []);
    setActiveMenu("이미지 분석");
    setStatus({ kind: "success", message: `${result.analyzed}개 이미지 분석 결과를 연결했습니다.` });
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "웹사이트 상품 정보를 추출하고 광고 이미지를 구성 중입니다." });
    const response = await fetch("/api/mvp/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl, referenceImageId: selectedReferenceId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus({ kind: "error", message: result.error ?? "광고 생성 실패" });
      return;
    }
    await refreshImages();
    setGeneratedPreview({ productName: result.product.productName });
    setActiveMenu("광고 생성");
    setStatus({ kind: "success", message: "1200x1200 광고 미리보기를 생성했습니다." });
    requestAnimationFrame(() => drawCanvas(result.product.productName, result.product.price, result.product.description));
  }

  function drawCanvas(productName: string, price: string, description: string) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = 1200;
    canvas.height = 1200;
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, 1200, 1200);
    context.fillStyle = "#0f766e";
    context.fillRect(0, 0, 1200, 170);
    context.fillStyle = "#ffffff";
    context.font = "800 56px Arial";
    context.fillText("ADATLAS GENERATED AD", 64, 105);
    context.fillStyle = "#111827";
    context.font = "800 72px Arial";
    wrapText(context, productName, 64, 320, 1050, 86);
    context.fillStyle = "#0f766e";
    context.font = "700 44px Arial";
    context.fillText(price || "상품 가격 확인", 64, 540);
    context.fillStyle = "#374151";
    context.font = "500 34px Arial";
    wrapText(context, description, 64, 650, 900, 48);
    context.fillStyle = "#111827";
    context.fillRect(64, 1010, 360, 92);
    context.fillStyle = "#ffffff";
    context.font = "800 34px Arial";
    context.fillText("지금 확인하기", 112, 1068);
  }

  function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      const testLine = `${line}${word} `;
      if (context.measureText(testLine).width > maxWidth && line) {
        context.fillText(line, x, y);
        line = `${word} `;
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    context.fillText(line, x, y);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "adatlas-generated-ad.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const rows = file.name.endsWith(".xlsx")
      ? normalizeRows(
          XLSX.utils.sheet_to_json<Record<string, unknown>>(
            XLSX.read(await file.arrayBuffer(), { type: "array" }).Sheets[
              XLSX.read(await file.arrayBuffer(), { type: "array" }).SheetNames[0]
            ],
          ),
        )
      : parseCsv(await file.text());
    const now = new Date().toISOString();
    const next = rows.map((row) => ({
      id: slug(row.brandName),
      brandName: row.brandName,
      category: row.category,
      metaLibraryUrl: row.metaLibraryUrl,
      tiktokUrl: row.tiktokUrl,
      enabled: row.enabled,
      createdAt: now,
      updatedAt: now,
    }));
    await saveBrands(next);
    setStatus({ kind: "success", message: `${next.length}개 브랜드를 가져왔습니다.` });
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
            <h2>브랜드 100개에서 광고 이미지를 모으고, 분석하고, 새 광고 이미지를 만듭니다.</h2>
          </div>
          <div className="mvp-primary-actions">
            <button onClick={handleCollectAll} type="button">오늘 이미지 수집 실행</button>
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

        {activeMenu === "브랜드 관리" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>브랜드 관리</h3>
              <label className="file-button">
                CSV/XLSX 업로드
                <input accept=".csv,.xlsx" onChange={handleFileUpload} type="file" />
              </label>
            </div>
            <div className="brand-table">
              {brands.slice(0, 100).map((brand, index) => (
                <article key={brand.id}>
                  <b>{index + 1}</b>
                  <input value={brand.brandName} onChange={(event) => {
                    const next = [...brands];
                    next[index] = { ...brand, brandName: event.target.value };
                    setBrands(next);
                  }} />
                  <input value={brand.category} onChange={(event) => {
                    const next = [...brands];
                    next[index] = { ...brand, category: event.target.value };
                    setBrands(next);
                  }} />
                  <input value={brand.metaLibraryUrl} onChange={(event) => {
                    const next = [...brands];
                    next[index] = { ...brand, metaLibraryUrl: event.target.value };
                    setBrands(next);
                  }} />
                  <label>
                    <input checked={brand.enabled} onChange={(event) => {
                      const next = [...brands];
                      next[index] = { ...brand, enabled: event.target.checked };
                      setBrands(next);
                    }} type="checkbox" />
                    ON
                  </label>
                </article>
              ))}
            </div>
            <button onClick={() => saveBrands(brands)} type="button">브랜드 저장</button>
          </section>
        ) : null}

        {activeMenu === "이미지 수집" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 수집</h3>
              <button onClick={handleCrawl} type="button">광고 수집하기</button>
            </div>
            <div className="crawler-controls">
              <select value={selectedBrandId} onChange={(event) => setSelectedBrandId(event.target.value)}>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.brandName}</option>
                ))}
              </select>
              <select value={crawlLimit} onChange={(event) => setCrawlLimit(Number(event.target.value))}>
                <option value={5}>5개 테스트</option>
                <option value={10}>10개</option>
                <option value={20}>20개</option>
              </select>
            </div>
            <div className="collection-state">
              <span>전체 브랜드 {collectionStatus.totalBrands}</span>
              <span>완료 브랜드 {collectionStatus.completedBrands}</span>
              <span>저장 이미지 {collectionStatus.collectedImages}</span>
              <span>실패 브랜드 {collectionStatus.failedBrands}</span>
            </div>
            {crawledItems.length ? <CrawledGrid items={crawledItems} /> : null}
            <ImageGrid images={images} />
          </section>
        ) : null}

        {activeMenu === "이미지 분석" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>이미지 분석</h3>
              <button onClick={handleAnalyze} type="button">AI 분석 실행</button>
            </div>
            <ImageGrid images={images} showAnalysis />
          </section>
        ) : null}

        {activeMenu === "광고 생성" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>광고 생성</h3>
            </div>
            <form className="generator-form" onSubmit={handleGenerate}>
              <input placeholder="상품 웹사이트 URL" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
              <select value={selectedReferenceId} onChange={(event) => setSelectedReferenceId(event.target.value)}>
                {images.map((image) => (
                  <option key={image.id} value={image.id}>{image.brandName} / {image.sourcePlatform}</option>
                ))}
              </select>
              <button type="submit">1200x1200 광고 생성</button>
            </form>
            <canvas className="generated-canvas" ref={canvasRef} width={1200} height={1200} />
            {generatedPreview ? <p className="generated-note">{generatedPreview.productName} 미리보기가 생성됐습니다.</p> : null}
          </section>
        ) : null}

        {activeMenu === "결과 다운로드" ? (
          <section className="mvp-panel">
            <div className="mvp-panel-head">
              <h3>결과 다운로드</h3>
              <button onClick={downloadPng} type="button">현재 미리보기 PNG 다운로드</button>
            </div>
            <div className="download-list">
              {generated.map((item) => (
                <article key={item.id}>
                  <strong>{item.productName}</strong>
                  <span>{new Date(item.createdAt).toLocaleString("ko-KR")}</span>
                </article>
              ))}
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
          <img alt={`${item.brandName} 수집 광고 이미지`} src={item.imageUrl} />
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

function ImageGrid({ images, showAnalysis = false }: { images: CollectedAdImage[]; showAnalysis?: boolean }) {
  return (
    <div className="mvp-image-grid">
      {images.map((image) => (
        <article key={image.id}>
          <img alt={`${image.brandName} 광고 이미지`} src={image.localImagePath || image.imageUrl} />
          <div>
            <strong>{image.brandName}</strong>
            <span>{image.sourcePlatform} / {new Date(image.collectedAt).toLocaleDateString("ko-KR")}</span>
            {showAnalysis && image.analysis ? (
              <p>{image.analysis.hookType} · {image.analysis.appealPoint}</p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

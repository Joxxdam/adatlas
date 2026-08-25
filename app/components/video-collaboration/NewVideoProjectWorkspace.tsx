"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { VIDEO_DESIGNER_OPTIONS, type BrandGuideline, type ProductAnalysisSnapshot, type VideoDuration, type VideoDurationMode, type VideoReferenceAsset } from "../../lib/video-collaboration/types";
import { useVideoPlanningOptions } from "../video-planning/useVideoPlanningOptions";
import styles from "../video-planning/VideoPlanning.module.css";

function guidelineFor(analysis: ProductAnalysisSnapshot, additional: string): BrandGuideline {
  return {
    toneAndManner: "후킹이 강하고 사람이 실제 숏폼에서 말하는 짧고 자연스러운 한국어",
    primaryAudience: analysis.targetCustomers[0] || "",
    coreUsps: analysis.coreUsps.join(" · "),
    requiredPhrases: [],
    forbiddenPhrases: analysis.cautionPhrases,
    advertiserRequests: additional,
    designerNotes: "이미지 생성 없이 자막·나레이션과 촬영 가능한 장면 설명만 작성",
  };
}

const durationOptions: Array<{ value: VideoDurationMode | `${VideoDuration}`; label: string }> = [
  { value: "auto", label: "AI 자동 추천" },
  { value: "15", label: "15초" },
  { value: "20", label: "20초" },
  { value: "30", label: "30초" },
  { value: "45", label: "45초" },
  { value: "60", label: "60초" },
];

export function NewVideoProjectWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { products } = useVideoPlanningOptions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [productUrl, setProductUrl] = useState(searchParams.get("productUrl") || "");
  const [analysis, setAnalysis] = useState<ProductAnalysisSnapshot | null>(null);
  const [advertiserName, setAdvertiserName] = useState("");
  const [additional, setAdditional] = useState("");
  const [requiredContent, setRequiredContent] = useState("");
  const [excludedContent, setExcludedContent] = useState("");
  const [durationChoice, setDurationChoice] = useState<VideoDurationMode | `${VideoDuration}`>("auto");
  const [designerName, setDesignerName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  function applyAnalysis(next: ProductAnalysisSnapshot, advertiser = "") {
    abortRef.current?.abort();
    setAnalysis(next);
    setProductUrl(next.productUrl || "");
    setAdvertiserName(advertiser || next.brandName || "");
    setError("");
  }

  async function analyze() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStage("상품 사실 분석 중");
    setError("");
    try {
      const response = await fetch("/api/video-projects/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productUrl }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "상품 분석에 실패했습니다.");
      applyAnalysis(payload.snapshot as ProductAnalysisSnapshot);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "상품 분석 실패");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function uploadReferences() {
    const assets: VideoReferenceAsset[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setStage(`참고자료 업로드 중 · ${index + 1}/${files.length}`);
      const form = new FormData();
      form.set("file", files[index]);
      const response = await fetch("/api/video-projects/attachments", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `${files[index].name} 업로드 실패`);
      assets.push(payload.asset as VideoReferenceAsset);
    }
    return assets;
  }

  async function createFourConcepts() {
    if (!analysis) return;
    if (!advertiserName.trim()) {
      setError("업체명을 입력해 주세요. 광고주 구분과 업체별 문구 말투에 사용됩니다.");
      return;
    }
    if (!designerName) {
      setError("담당 디자이너를 조이 또는 애니 중에서 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const referenceAssets = await uploadReferences();
      const durationMode: VideoDurationMode = durationChoice === "auto" ? "auto" : "fixed";
      const duration = durationChoice === "auto" ? (referenceAssets.some((asset) => asset.mimeType.startsWith("video/")) ? 45 : 30) : (Number(durationChoice) as VideoDuration);
      setStage("상품 사실과 제작 조건 저장 중");
      const response = await fetch("/api/video-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectName: `${analysis.productName} · 영상 콘셉트 4안`,
          advertiserName: advertiserName.trim(),
          productUrl,
          marketerName: "마케터",
          designerName,
          duration,
          durationMode,
          planningMode: "four-concepts",
          format: "short-form",
          objective: "new-customer-hook",
          platform: "meta",
          aspectRatio: "9:16",
          creativeStyle: "auto",
          additionalRequests: additional,
          requiredContent,
          excludedContent,
          deadline,
          referenceAssets,
          productAnalysis: analysis,
          brandGuideline: guidelineFor(analysis, additional),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "영상 기획을 시작하지 못했습니다.");
      const projectId = payload.project.id as string;
      setStage(referenceAssets.length ? "참고자료 분석 · 편집 원리 추출 중" : "고객 상황과 후킹 후보 발굴 중");
      const conceptResponse = await fetch(`/api/video-projects/${projectId}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "마케터" }),
      });
      await conceptResponse.json();
      if (!conceptResponse.ok) {
        router.push(`/video-planning/${projectId}?generation=retry`);
        return;
      }
      router.push(`/video-planning/${projectId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 생성 실패");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href="/video-planning">← 영상 기획 목록</Link>
          <p className={styles.eyebrow}>NEW VIDEO PLAN</p>
          <h1>상품 하나로 콘셉트 4개 만들기</h1>
          <p>유형 선택 없이 상품 사실을 바탕으로 사건·상황극·리얼 후기·USP·혜택형을 각각 만듭니다.</p>
        </div>
        <div className={styles.planningSteps}>
          <span data-active>1 상품 분석</span>
          <span data-active={Boolean(analysis)}>2 선택 정보</span>
          <span>3 콘셉트 비교</span>
        </div>
      </header>
      {error ? (
        <div className={styles.error}>
          <strong>입력 내용은 유지되었습니다.</strong>
          {error}
        </div>
      ) : null}
      {busy && stage ? (
        <div className={styles.generationNotice}>
          <span className={styles.loadingDot} />
          <div>
            <strong>{stage}</strong>
            <p>상품 사실 → 후킹 발굴 → 4개 콘셉트 → 품질검사 순서로 진행합니다.</p>
          </div>
        </div>
      ) : null}
      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>REQUIRED</p>
            <h2>상품 URL 또는 기존 상품</h2>
            <p>상품 이미지와 참고파일은 없어도 됩니다.</p>
          </div>
        </div>
        <div className={styles.videoUrlRow}>
          <input aria-label="상품 URL" onChange={(event) => setProductUrl(event.target.value)} placeholder="https://shop.example.com/product/..." type="url" value={productUrl} />
          <button className={styles.primaryButton} disabled={busy || !productUrl.trim()} onClick={analyze}>
            {busy && stage.includes("상품 사실") ? "분석 중…" : "상품 분석"}
          </button>
        </div>
        {products.length ? (
          <div className={styles.recentProducts}>
            <strong>최근 등록 상품</strong>
            <div>
              {products.slice(0, 6).map((product) => (
                <button key={product.id} onClick={() => applyAnalysis(product.analysis, product.advertiserName)}>
                  <span>{product.advertiserName}</span>
                  {product.productName}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {analysis ? (
        <>
          <section className={styles.productSummaryBar}>
            <div>
              <span>분석 상품</span>
              <strong>{analysis.productName}</strong>
              <small>{advertiserName || "업체명 입력 필요"}</small>
            </div>
            <div className={styles.productFactChips}>
              {[...analysis.coreUsps, ...analysis.keyFeatures].slice(0, 5).map((fact, index) => (
                <span key={`${index}-${fact}`}>{fact}</span>
              ))}
            </div>
            <button className={styles.ghostButton} onClick={() => setAnalysis(null)}>
              상품 바꾸기
            </button>
          </section>
          <section className={styles.summaryPanel}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>PROJECT INFO</p>
                <h2>업체명과 제작 조건</h2>
                <p>업체명을 확인하고, 필요한 제작 조건만 추가하세요.</p>
              </div>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.wide}>
                업체명 (필수)
                <input
                  aria-label="업체명"
                  autoComplete="organization"
                  onChange={(event) => setAdvertiserName(event.target.value)}
                  placeholder="예: 국대한우"
                  required
                  type="text"
                  value={advertiserName}
                />
                <small>상품 분석 결과가 자동 입력됩니다. 광고주 구분과 업체별 문구 말투에 사용할 정확한 이름으로 수정할 수 있습니다.</small>
              </label>
              <label>
                상품에 관해 추가로 알려줄 내용
                <textarea value={additional} onChange={(event) => setAdditional(event.target.value)} />
              </label>
              <label>
                반드시 넣을 내용
                <textarea value={requiredContent} onChange={(event) => setRequiredContent(event.target.value)} />
              </label>
              <label>
                제외할 내용
                <textarea value={excludedContent} onChange={(event) => setExcludedContent(event.target.value)} />
              </label>
              <label>
                영상 길이
                <select value={durationChoice} onChange={(event) => setDurationChoice(event.target.value as typeof durationChoice)}>
                  {durationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                담당 디자이너
                <select required value={designerName} onChange={(event) => setDesignerName(event.target.value)}>
                  <option value="">담당 디자이너 선택</option>
                  {VIDEO_DESIGNER_OPTIONS.map((designer) => (
                    <option key={designer} value={designer}>
                      {designer}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                제작 마감일
                <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </label>
              <label className={styles.wide}>
                참고 이미지·영상·PDF
                <input accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/quicktime,video/webm" multiple type="file" onChange={(event) => setFiles(Array.from(event.target.files || []))} />
                <small>{files.length ? `${files.length}개 선택됨 · 원문 복제 없이 구조와 편집 원리만 참고` : "선택하지 않아도 정상 생성됩니다."}</small>
              </label>
            </div>
            <div className={styles.stickyAction}>
              <div>
                <strong>사건·상황극 · 리얼 사용/후기 · USP 집중 · 시크릿 혜택</strong>
                <span>첫 자막, 사건, 화자, 소구, 결말이 서로 다르게 생성됩니다.</span>
              </div>
              <button className={styles.primaryButton} disabled={busy || !advertiserName.trim() || !designerName} onClick={createFourConcepts}>
                {busy ? stage || "생성 중…" : "4개 콘셉트 생성"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

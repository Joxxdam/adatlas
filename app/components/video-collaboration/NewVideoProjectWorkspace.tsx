"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  type BrandGuideline,
  type ProductAnalysisSnapshot,
  type VideoConceptFormat,
} from "../../lib/video-collaboration/types";
import { useVideoPlanningOptions } from "../video-planning/useVideoPlanningOptions";
import styles from "../video-planning/VideoPlanning.module.css";

function guidelineFor(analysis: ProductAnalysisSnapshot): BrandGuideline {
  return {
    toneAndManner: "상품 상세페이지의 실제 표현을 살리되 짧고 자연스러운 한국어 자막으로 작성",
    primaryAudience: analysis.targetCustomers[0] || "",
    coreUsps: analysis.coreUsps.join(" · "),
    requiredPhrases: [],
    forbiddenPhrases: analysis.cautionPhrases,
    advertiserRequests: "",
    designerNotes: "이미지를 만들지 말고 자막과 구체적인 영상 장면 설명만 작성",
  };
}

export function NewVideoProjectWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { products } = useVideoPlanningOptions();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [productUrl, setProductUrl] = useState(searchParams.get("productUrl") || "");
  const [analysis, setAnalysis] = useState<ProductAnalysisSnapshot | null>(null);
  const [advertiserName, setAdvertiserName] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<VideoConceptFormat | "">("");
  const [generationStage, setGenerationStage] = useState("");
  const analysisAbortController = useRef<AbortController | null>(null);

  const selectedOption = useMemo(
    () => VIDEO_CONCEPT_FORMAT_OPTIONS.find((option) => option.id === selectedFormat),
    [selectedFormat]
  );
  const hasEvidence = Boolean(analysis?.coreUsps.length || analysis?.keyFeatures.length);

  function applyAnalysis(next: ProductAnalysisSnapshot, nextAdvertiser = "") {
    analysisAbortController.current?.abort();
    analysisAbortController.current = null;
    setBusy(false);
    setGenerationStage("");
    setError("");
    setAnalysis(next);
    setProductUrl(next.productUrl || "");
    setAdvertiserName(nextAdvertiser || next.brandName || "업체 미확인");
    setSelectedFormat("");
    setStep(2);
  }

  async function analyze() {
    analysisAbortController.current?.abort();
    const controller = new AbortController();
    analysisAbortController.current = controller;
    setBusy(true);
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
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "상품 분석 실패");
      }
    } finally {
      if (analysisAbortController.current === controller) {
        analysisAbortController.current = null;
        setBusy(false);
      }
    }
  }

  async function createPlanning() {
    if (!analysis || !selectedOption || !hasEvidence) return;
    setBusy(true);
    setError("");
    try {
      setGenerationStage("상품 근거와 선택한 콘셉트를 정리하는 중");
      const response = await fetch("/api/video-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectName: `${analysis.productName} · ${selectedOption.title}`,
          advertiserName: advertiserName || analysis.brandName || "업체 미확인",
          productUrl,
          marketerName: "마케터",
          designerName: "",
          duration: 20,
          format: "short-form",
          objective: "new-customer-hook",
          platform: "meta",
          aspectRatio: "9:16",
          creativeStyle: selectedOption.creativeStyle,
          conceptFormat: selectedOption.id,
          advancedTarget: "",
          advancedTone: "",
          additionalRequests: "",
          deadline: "",
          referenceAssets: [],
          productAnalysis: analysis,
          brandGuideline: guidelineFor(analysis),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "영상 기획을 시작하지 못했습니다.");

      setGenerationStage(`${selectedOption.title} 자막과 장면 흐름을 설계하는 중`);
      const conceptResponse = await fetch(`/api/video-projects/${payload.project.id}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "마케터" }),
      });
      const conceptPayload = await conceptResponse.json();
      if (!conceptResponse.ok || !conceptPayload.concepts?.[0]) {
        router.push(`/video-planning/${payload.project.id}?generation=retry`);
        return;
      }

      const conceptId = conceptPayload.concepts[0].id as string;
      setGenerationStage("자막과 영상 장면안을 구간별로 작성하는 중");
      await fetch(`/api/video-projects/${payload.project.id}/concepts/${conceptId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate-detail", actor: "마케터" }),
      });
      router.push(`/video-planning/${payload.project.id}/concept/${conceptId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 생성 실패");
    } finally {
      setBusy(false);
      setGenerationStage("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href="/video-planning">← 영상 기획 목록</Link>
          <p className={styles.eyebrow}>NEW VIDEO PLAN</p>
          <h1>어떤 방식의 영상으로 만들까요?</h1>
          <p>상품을 분석한 뒤 콘셉트 하나를 크게 선택하면 자막과 촬영 가능한 장면안만 만듭니다.</p>
        </div>
        <div className={styles.planningSteps} aria-label="영상 기획 단계">
          <span data-active={step >= 1}>1 상품 분석</span>
          <span data-active={step >= 2}>2 콘셉트 선택</span>
          <span>3 자막·장면안</span>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {busy && generationStage ? (
        <div className={styles.generationNotice}>
          <span className={styles.loadingDot} />
          <div><strong>{generationStage}</strong><p>이미지나 영상을 생성하지 않고 기획 문서만 작성합니다.</p></div>
        </div>
      ) : null}

      {step === 1 ? (
        <section className={styles.summaryPanel}>
          <div className={styles.sectionHead}>
            <div><p className={styles.eyebrow}>STEP 1</p><h2>기획할 상품을 알려주세요</h2><p>상세페이지의 실제 상품 특징과 표현 근거를 영상 기획에 사용합니다.</p></div>
          </div>
          <div className={styles.videoUrlRow}>
            <input aria-label="상품 URL" onChange={(event) => setProductUrl(event.target.value)} placeholder="https://shop.example.com/product/..." type="url" value={productUrl} />
            <button className={styles.primaryButton} disabled={busy || !productUrl.trim()} onClick={analyze}>{busy ? "상품 분석 중…" : "상품 분석하기"}</button>
          </div>
          {products.length ? (
            <div className={styles.recentProducts}>
              <strong>최근 분석 상품</strong>
              <div>{products.slice(0, 6).map((product) => <button key={product.id} onClick={() => applyAnalysis(product.analysis, product.advertiserName)}><span>{product.advertiserName}</span>{product.productName}</button>)}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 2 && analysis ? (
        <>
          <section className={styles.productSummaryBar}>
            <div><span>분석 상품</span><strong>{analysis.productName}</strong><small>{advertiserName || analysis.brandName}</small></div>
            <div className={styles.productFactChips}>{[...analysis.coreUsps, ...analysis.keyFeatures].slice(0, 4).map((fact) => <span key={fact}>{fact}</span>)}</div>
            <button className={styles.ghostButton} onClick={() => setStep(1)}>상품 바꾸기</button>
          </section>

          <section className={styles.summaryPanel}>
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>STEP 2</p><h2>영상 콘셉트 선택</h2><p>드롭다운 없이 원하는 제작 방식을 카드에서 바로 선택하세요.</p></div>
              {selectedOption ? <span className={styles.selectedBadge}>{selectedOption.title} 선택됨</span> : null}
            </div>
            <div className={styles.formatGrid} role="group" aria-label="영상 콘셉트 형식">
              {VIDEO_CONCEPT_FORMAT_OPTIONS.map((option, index) => (
                <button aria-pressed={selectedFormat === option.id} className={styles.formatCard} data-selected={selectedFormat === option.id} key={option.id} onClick={() => setSelectedFormat(option.id)}>
                  <span className={styles.formatNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.formatKicker}>{option.kicker}</span>
                  <strong>{option.title}</strong>
                  <p>{option.description}</p>
                  <small>{option.flow}</small>
                  <span className={styles.cardCheck}>{selectedFormat === option.id ? "선택 완료" : "이 방식 선택"}</span>
                </button>
              ))}
            </div>
            <div className={styles.stickyAction}>
              <div><strong>{selectedOption ? selectedOption.title : "콘셉트를 하나 선택해 주세요"}</strong><span>{selectedOption ? "20초 기준 자막과 구체적인 영상 장면안을 생성합니다." : "선택한 콘셉트에 맞춰 전체 전개가 달라집니다."}</span></div>
              <button className={styles.primaryButton} disabled={busy || !selectedOption || !hasEvidence} onClick={createPlanning}>{busy ? generationStage || "기획 생성 중…" : "이 콘셉트로 자막·장면안 만들기"}</button>
            </div>
            {!hasEvidence ? <div className={styles.error}>상세페이지에서 영상 기획에 사용할 상품 특징을 충분히 확인하지 못했습니다. 다른 상품 URL로 다시 분석해 주세요.</div> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}

/* eslint-disable @next/next/no-img-element -- Native images preserve pixel-accurate crop and mask previews. */
"use client";

import { useMemo, useState } from "react";
import {
  buildReviewHeadline,
  clampReviewBox,
  recommendReviewTemplate,
  reviewTemplateLabel,
  reviewTypeLabel,
} from "../../../lib/mvp/reviewCreative";
import type {
  NormalizedImageBox,
  ReviewCreativeTemplate,
  ReviewPrivacyMaskStyle,
  ReviewPrivacyRegion,
  ReviewSourceCandidate,
  ReviewType,
} from "../../../lib/mvp/types";
import styles from "./ReviewCreativeWorkbench.module.css";

type EditSnapshot = {
  crops: Record<string, NormalizedImageBox>;
  masks: Record<string, ReviewPrivacyRegion[]>;
};

const reviewTypes: ReviewType[] = [
  "review-text-screenshot",
  "review-photo-with-text",
  "review-photo-only",
  "community-reaction",
  "before-after",
  "review-card",
  "testimonial-graphic",
  "not-review",
];
const templates: ReviewCreativeTemplate[] = [
  "reaction-comment",
  "real-review-focus",
  "review-collection",
  "before-after-usage",
];

function initialIds(candidates: ReviewSourceCandidate[]) {
  const recommended = candidates.find((candidate) => candidate.recommended) || candidates[0];
  return recommended ? [recommended.id] : [];
}

function initialCrops(candidates: ReviewSourceCandidate[]) {
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.recommendedCrop]));
}

function initialMasks(candidates: ReviewSourceCandidate[]) {
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.privacyRegions]));
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function cropImageStyle(crop: NormalizedImageBox) {
  return {
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  };
}

function maskInCrop(mask: NormalizedImageBox, crop: NormalizedImageBox) {
  const left = (mask.x - crop.x) / crop.width;
  const top = (mask.y - crop.y) / crop.height;
  return {
    left: pct(left),
    top: pct(top),
    width: pct(mask.width / crop.width),
    height: pct(mask.height / crop.height),
  };
}

function maskClass(style: ReviewPrivacyMaskStyle) {
  if (style === "mosaic") return styles.mosaicMask;
  if (style === "solid") return styles.solidMask;
  return styles.blurMask;
}

function reviewTextKey(value: string) {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().slice(0, 180);
}

function keySentenceRegion(candidate: ReviewSourceCandidate) {
  const key = reviewTextKey(candidate.keySentence).slice(0, 24);
  if (!key) return undefined;
  return candidate.textRegions.find((region) => {
    const text = reviewTextKey(region.text || "");
    return text.includes(key) || key.includes(text.slice(0, 12));
  })?.box;
}

export default function ReviewCreativeWorkbench(props: {
  initialCandidates: ReviewSourceCandidate[];
  productName: string;
  productDescription?: string;
  productImagePath?: string;
  backgroundImagePath?: string;
  accentColor?: string;
}) {
  const [candidates, setCandidates] = useState(() => props.initialCandidates.slice(0, 5));
  const [selectedIds, setSelectedIds] = useState(() => initialIds(props.initialCandidates));
  const [crops, setCrops] = useState(() => initialCrops(props.initialCandidates));
  const [masks, setMasks] = useState(() => initialMasks(props.initialCandidates));
  const [template, setTemplate] = useState<ReviewCreativeTemplate>(() =>
    recommendReviewTemplate(props.initialCandidates, initialIds(props.initialCandidates))
  );
  const [headline, setHeadline] = useState(() =>
    buildReviewHeadline(props.initialCandidates.find((candidate) => candidate.recommended) || props.initialCandidates[0])
  );
  const [status, setStatus] = useState<{
    kind: "idle" | "loading" | "success" | "error";
    message: string;
  }>({ kind: "idle", message: "" });
  const [generatedImagePath, setGeneratedImagePath] = useState("");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [undoStack, setUndoStack] = useState<EditSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditSnapshot[]>([]);

  const primary = candidates.find((candidate) => candidate.id === selectedIds[0]) || candidates[0];
  const primaryCrop = primary ? crops[primary.id] || primary.recommendedCrop : undefined;
  const primaryMasks = primary ? masks[primary.id] || [] : [];

  const selectedCandidates = useMemo(
    () => selectedIds.map((id) => candidates.find((candidate) => candidate.id === id)).filter(Boolean) as ReviewSourceCandidate[],
    [candidates, selectedIds]
  );

  function snapshot(): EditSnapshot {
    return {
      crops: structuredClone(crops),
      masks: structuredClone(masks),
    };
  }

  function commitEdit(next: EditSnapshot) {
    setUndoStack((current) => [...current.slice(-19), snapshot()]);
    setRedoStack([]);
    setCrops(next.crops);
    setMasks(next.masks);
  }

  function selectPrimary(candidate: ReviewSourceCandidate) {
    setSelectedIds((current) => [candidate.id, ...current.filter((id) => id !== candidate.id)].slice(0, 3));
    const nextTemplate = recommendReviewTemplate(candidates, [candidate.id]);
    setTemplate(nextTemplate);
    setHeadline(buildReviewHeadline(candidate));
    setGeneratedImagePath("");
  }

  function toggleCollection(candidate: ReviewSourceCandidate) {
    setSelectedIds((current) => {
      if (current.includes(candidate.id)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== candidate.id);
      }
      const duplicateText = reviewTextKey(candidate.ocrText);
      if (
        duplicateText.length >= 24 &&
        current.some((id) =>
          candidates.some(
            (item) => item.id === id && reviewTextKey(item.ocrText) === duplicateText
          )
        )
      ) {
        setStatus({ kind: "error", message: "같은 내용의 후기는 모음형에 중복 추가할 수 없습니다." });
        return current;
      }
      return [...current, candidate.id].slice(0, 3);
    });
    setTemplate("review-collection");
    setGeneratedImagePath("");
  }

  function updateCandidate(id: string, patch: Partial<ReviewSourceCandidate>) {
    setCandidates((current) => current.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)));
    setGeneratedImagePath("");
  }

  async function analyzeImage(input: {
    imagePath: string;
    sourceType: ReviewSourceCandidate["sourceType"];
    sourceContext?: string;
  }) {
    const response = await fetch("/api/reviews/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        productName: props.productName,
        productDescription: props.productDescription || "",
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "후기 분석 실패");
    return result.candidate as ReviewSourceCandidate;
  }

  async function reanalyze(candidate: ReviewSourceCandidate) {
    setStatus({ kind: "loading", message: "후기 OCR과 개인정보 영역을 다시 분석하고 있습니다." });
    try {
      const next = await analyzeImage({
        imagePath: candidate.imagePath,
        sourceType: candidate.sourceType,
        sourceContext: candidate.sourceContext,
      });
      setCandidates((current) => current.map((item) => (item.id === candidate.id ? { ...next, id: candidate.id } : item)));
      setCrops((current) => ({ ...current, [candidate.id]: next.recommendedCrop }));
      setMasks((current) => ({ ...current, [candidate.id]: next.privacyRegions }));
      setHeadline(buildReviewHeadline(next));
      setStatus({ kind: "success", message: `OCR 재분석 완료 · ${next.ocrProvider}` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "후기 재분석 실패" });
    }
  }

  async function uploadReview(file?: File) {
    if (!file) return;
    setStatus({ kind: "loading", message: "후기 이미지를 안전하게 업로드하고 OCR을 실행하고 있습니다." });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadResponse = await fetch("/api/upload/source-image", { method: "POST", body: formData });
      const uploaded = await uploadResponse.json();
      if (!uploadResponse.ok || !uploaded.success) throw new Error(uploaded.error || "후기 업로드 실패");
      const next = await analyzeImage({ imagePath: uploaded.imagePath, sourceType: "upload" });
      const duplicate = candidates.find(
        (candidate) =>
          (next.contentHash && candidate.contentHash === next.contentHash) ||
          (reviewTextKey(next.ocrText).length >= 24 &&
            reviewTextKey(candidate.ocrText) === reviewTextKey(next.ocrText))
      );
      if (duplicate) {
        selectPrimary(duplicate);
        setStatus({ kind: "success", message: "동일한 후기 이미지가 이미 있어 기존 분석 결과를 재사용했습니다." });
        return;
      }
      const id = `${next.id}-${Date.now()}`;
      const added = { ...next, id, selected: true, recommended: candidates.length === 0 };
      setCandidates((current) => [added, ...current].slice(0, 5));
      setCrops((current) => ({ ...current, [id]: next.recommendedCrop }));
      setMasks((current) => ({ ...current, [id]: next.privacyRegions }));
      setSelectedIds([id]);
      setTemplate(recommendReviewTemplate([added], [id]));
      setHeadline(buildReviewHeadline(added));
      setStatus({ kind: "success", message: `후기 업로드와 OCR 분석을 완료했습니다. · ${next.ocrProvider}` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "후기 업로드 실패" });
    }
  }

  function updateCrop(key: keyof NormalizedImageBox, value: number) {
    if (!primary || !primaryCrop) return;
    const nextCrop = clampReviewBox({ ...primaryCrop, [key]: value });
    commitEdit({ crops: { ...crops, [primary.id]: nextCrop }, masks });
    setGeneratedImagePath("");
  }

  function resetCrop() {
    if (!primary) return;
    commitEdit({ crops: { ...crops, [primary.id]: primary.recommendedCrop }, masks });
  }

  function resetPrimaryEdits() {
    if (!primary) return;
    commitEdit({
      crops: { ...crops, [primary.id]: primary.recommendedCrop },
      masks: { ...masks, [primary.id]: primary.privacyRegions },
    });
    setPreviewZoom(1);
    setStatus({ kind: "idle", message: "수동 수정을 취소하고 자동 분석 결과로 되돌렸습니다." });
  }

  function addMask() {
    if (!primary) return;
    const mask: ReviewPrivacyRegion = {
      id: `manual-mask-${Date.now()}`,
      role: "unknown",
      confidence: 1,
      reason: "사용자 지정 가림 영역",
      enabled: true,
      maskStyle: "blur",
      box: { x: 0.35, y: 0.35, width: 0.3, height: 0.12 },
    };
    commitEdit({ crops, masks: { ...masks, [primary.id]: [...primaryMasks, mask] } });
  }

  function updateMask(id: string, patch: Partial<ReviewPrivacyRegion>) {
    if (!primary) return;
    commitEdit({
      crops,
      masks: {
        ...masks,
        [primary.id]: primaryMasks.map((mask) =>
          mask.id === id
            ? { ...mask, ...patch, box: patch.box ? clampReviewBox(patch.box) : mask.box }
            : mask
        ),
      },
    });
    setGeneratedImagePath("");
  }

  function deleteMask(id: string) {
    if (!primary) return;
    commitEdit({ crops, masks: { ...masks, [primary.id]: primaryMasks.filter((mask) => mask.id !== id) } });
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current, snapshot()]);
    setUndoStack((current) => current.slice(0, -1));
    setCrops(previous.crops);
    setMasks(previous.masks);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current, snapshot()]);
    setRedoStack((current) => current.slice(0, -1));
    setCrops(next.crops);
    setMasks(next.masks);
  }

  async function renderCreative() {
    if (!selectedCandidates.length) return;
    setStatus({ kind: "loading", message: "실제 후기 크롭과 상품 누끼를 1200×1200 소재로 합성하고 있습니다." });
    try {
      const response = await fetch("/api/reviews/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template,
          headline,
          reviews: selectedCandidates.map((candidate) => ({
            id: candidate.id,
            imagePath: candidate.imagePath,
            crop: crops[candidate.id] || candidate.recommendedCrop,
            privacyMasks: masks[candidate.id] || candidate.privacyRegions,
            highlightBox: keySentenceRegion(candidate),
          })),
          productImagePath: props.productImagePath || "",
          backgroundImagePath: props.backgroundImagePath || "",
          accentColor: props.accentColor || "",
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "후기 소재 생성 실패");
      setGeneratedImagePath(result.imagePath);
      setStatus({ kind: "success", message: `1200×1200 후기 광고 소재를 생성했습니다.${result.cached ? " · 캐시 재사용" : ""}` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "후기 소재 생성 실패" });
    }
  }

  return (
    <section className={styles.workbench}>
      <div className={styles.header}>
        <div>
          <span>REVIEW CREATIVE</span>
          <h3>후기 이미지 기반 광고 소재</h3>
          <p>실제 후기 원문을 크롭하고 개인정보를 가린 뒤 상품 누끼와 합성합니다.</p>
        </div>
        <label className={styles.uploadButton}>
          후기 직접 업로드
          <input accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadReview(event.target.files?.[0])} type="file" />
        </label>
      </div>

      {status.message ? <p className={`${styles.status} ${styles[status.kind]}`}>{status.message}</p> : null}

      {!candidates.length ? (
        <div className={styles.empty}>
          <strong>상세페이지에서 활용 가능한 후기 이미지를 찾지 못했습니다.</strong>
          <span>후기 이미지를 직접 업로드하면 후기 소재를 제작할 수 있습니다.</span>
        </div>
      ) : (
        <>
          <div className={styles.candidateGrid}>
            {candidates.map((candidate) => {
              const selected = selectedIds.includes(candidate.id);
              return (
                <article className={`${styles.candidate} ${selected ? styles.selected : ""}`} key={candidate.id}>
                  <div className={styles.candidateImage}><img alt="후기 후보" src={candidate.imagePath} /></div>
                  <div className={styles.badges}>
                    {candidate.recommended ? <b>AI 추천</b> : null}
                    <span>{reviewTypeLabel(candidate.reviewType)}</span>
                    <span>활용 {Math.round(candidate.overallReviewScore * 100)}</span>
                  </div>
                  <strong>{candidate.keySentence || "핵심 문장 직접 입력 필요"}</strong>
                  <small>
                    OCR {candidate.ocrProvider} · {Math.round(candidate.ocrConfidence * 100)}%
                    {candidate.privacyRegions.length ? ` · 개인정보 ${candidate.privacyRegions.length}곳` : ""}
                  </small>
                  <div className={styles.cardActions}>
                    <button onClick={() => selectPrimary(candidate)} type="button">이 후기 사용</button>
                    <label><input checked={selected} onChange={() => toggleCollection(candidate)} type="checkbox" /> 모음에 추가</label>
                  </div>
                </article>
              );
            })}
          </div>

          {primary && primaryCrop ? (
            <>
              <div className={styles.controls}>
                <label>
                  <span>추천 템플릿</span>
                  <select value={template} onChange={(event) => { setTemplate(event.target.value as ReviewCreativeTemplate); setGeneratedImagePath(""); }}>
                    {templates.map((item) => <option key={item} value={item}>{reviewTemplateLabel(item)}</option>)}
                  </select>
                </label>
                <label className={styles.headlineField}>
                  <span>상단 후킹 문구</span>
                  <input maxLength={120} value={headline} onChange={(event) => { setHeadline(event.target.value); setGeneratedImagePath(""); }} />
                  <small>AI 광고 문구이며 실제 후기 인용문처럼 따옴표로 표시하지 않습니다.</small>
                </label>
                <button disabled={status.kind === "loading"} onClick={renderCreative} type="button">후기 광고 소재 생성</button>
              </div>

              <div className={styles.previewGrid}>
                <figure><figcaption>원본 후기</figcaption><div className={styles.previewSurface}><img alt="원본 후기" src={primary.imagePath} /></div></figure>
                <figure><figcaption>자동·수정 크롭</figcaption><div className={styles.cropSurface}><div className={styles.zoomLayer} style={{ transform: `scale(${previewZoom})` }}><img alt="후기 크롭" src={primary.imagePath} style={cropImageStyle(primaryCrop)} /></div></div></figure>
                <figure>
                  <figcaption>개인정보 가림 미리보기</figcaption>
                  <div className={styles.cropSurface}>
                    <div className={styles.zoomLayer} style={{ transform: `scale(${previewZoom})` }}>
                      <img alt="개인정보 가림 후기" src={primary.imagePath} style={cropImageStyle(primaryCrop)} />
                      {primaryMasks.filter((mask) => mask.enabled).map((mask) => <span className={maskClass(mask.maskStyle)} key={mask.id} style={maskInCrop(mask.box, primaryCrop)} />)}
                    </div>
                  </div>
                </figure>
                <figure><figcaption>1200×1200 합성 결과</figcaption><div className={styles.previewSurface}>{generatedImagePath ? <img alt="후기 광고 결과" src={generatedImagePath} /> : <span>소재 생성 후 표시됩니다.</span>}</div></figure>
              </div>

              <details className={styles.advanced}>
                <summary>고급 옵션 · OCR, 크롭, 개인정보 마스킹 수정</summary>
                <div className={styles.historyActions}>
                  <button disabled={!undoStack.length} onClick={undo} type="button">실행 취소</button>
                  <button disabled={!redoStack.length} onClick={redo} type="button">다시 실행</button>
                  <button onClick={resetCrop} type="button">자동 크롭으로 초기화</button>
                  <button onClick={() => reanalyze(primary)} type="button">다시 분석</button>
                  <button onClick={() => setStatus({ kind: "success", message: "현재 크롭과 마스킹 수정 결과를 렌더링에 적용합니다." })} type="button">수정 결과 적용</button>
                  <button onClick={resetPrimaryEdits} type="button">수정 취소</button>
                </div>
                <div className={styles.advancedGrid}>
                  <label><span>후기 유형</span><select value={primary.reviewType} onChange={(event) => updateCandidate(primary.id, { reviewType: event.target.value as ReviewType, classificationConfidence: 1 })}>{reviewTypes.map((type) => <option key={type} value={type}>{reviewTypeLabel(type)}</option>)}</select></label>
                  <label><span>핵심 후기 문장</span><input value={primary.keySentence} onChange={(event) => updateCandidate(primary.id, { keySentence: event.target.value })} /></label>
                  <label className={styles.full}><span>실제 OCR 원문</span><textarea rows={6} value={primary.ocrText} onChange={(event) => updateCandidate(primary.id, { ocrText: event.target.value, ocrProvider: "manual" })} /></label>
                </div>
                <div className={styles.sliderGrid}>
                  <label><span>미리보기 확대 · {previewZoom.toFixed(1)}×</span><input min="1" max="2.5" step="0.1" type="range" value={previewZoom} onChange={(event) => setPreviewZoom(Number(event.target.value))} /></label>
                  {(["x", "y", "width", "height"] as const).map((key) => <label key={key}><span>크롭 {key} · {pct(primaryCrop[key])}</span><input min="0" max="1" step="0.01" type="range" value={primaryCrop[key]} onChange={(event) => updateCrop(key, Number(event.target.value))} /></label>)}
                </div>
                <div className={styles.maskHeader}><strong>개인정보 마스킹</strong><button onClick={addMask} type="button">가림 영역 추가</button></div>
                {primaryMasks.map((mask) => (
                  <div className={styles.maskRow} key={mask.id}>
                    <label><input checked={mask.enabled} onChange={(event) => updateMask(mask.id, { enabled: event.target.checked })} type="checkbox" /> {mask.reason}</label>
                    <select value={mask.maskStyle} onChange={(event) => updateMask(mask.id, { maskStyle: event.target.value as ReviewPrivacyMaskStyle })}><option value="blur">블러</option><option value="mosaic">모자이크</option><option value="solid">단색</option></select>
                    {(["x", "y", "width", "height"] as const).map((key) => <label key={key}><span>{key}</span><input min="0" max="1" step="0.01" type="range" value={mask.box[key]} onChange={(event) => updateMask(mask.id, { box: { ...mask.box, [key]: Number(event.target.value) } })} /></label>)}
                    <button onClick={() => deleteMask(mask.id)} type="button">삭제</button>
                  </div>
                ))}
              </details>

              <p className={styles.rightsNotice}>실제 광고에 사용하기 전 후기 이미지의 광고 활용 권한과 개인정보 포함 여부를 확인해주세요.</p>
              {generatedImagePath ? <a className={styles.download} download href={generatedImagePath}>1200×1200 PNG 다운로드</a> : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

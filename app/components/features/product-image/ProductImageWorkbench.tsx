"use client";

import { useMemo, useRef, useState } from "react";
import {
  extractionScopeLabel,
  representationTypeLabel,
} from "../../../lib/mvp/productImagePipeline";
import type {
  NormalizedImageBox,
  ProductCutoutQuality,
  ProductExtractionScope,
  ProductImageState,
  ProductRepresentation,
  ProductRepresentationType,
  SourceImageCandidate,
} from "../../../lib/mvp/types";
import styles from "./ProductImageWorkbench.module.css";

type ReprocessOptions = {
  imagePath: string;
  representationType: ProductRepresentationType;
  extractionScope: ProductExtractionScope;
  selectedObjectIds: string[];
  selectedObjectBoxes?: NormalizedImageBox[];
  cropBox?: NormalizedImageBox;
};

type Stroke = {
  id: string;
  mode: "erase" | "restore";
  x: number;
  y: number;
  radius: number;
};

type Props = {
  candidates: SourceImageCandidate[];
  representation: ProductRepresentation;
  imageState: ProductImageState;
  selectedSourceImagePath: string;
  recommendedBackgroundPath?: string;
  busy: boolean;
  statusMessage: string;
  onRepresentationChange: (type: ProductRepresentationType) => void;
  onScopeChange: (scope: ProductExtractionScope) => void;
  onSourceChange: (candidate: SourceImageCandidate) => void;
  onReprocess: (options: ReprocessOptions) => Promise<void>;
  onUseOriginal: () => void;
  onUseCutout: () => void;
  onUpload: (file: File | undefined) => void;
  onManualResult: (imagePath: string, quality: ProductCutoutQuality) => void;
};

const representationTypes: ProductRepresentationType[] = [
  "single-product",
  "multi-unit-set",
  "irregular-product",
  "packaged-product",
  "product-package-group",
  "bundle-components",
  "plated-product",
  "apparel-or-soft-product",
  "transparent-or-reflective-product",
  "already-transparent",
];

const extractionScopes: ProductExtractionScope[] = [
  "single-item",
  "visible-all",
  "sales-unit",
  "product-and-package",
  "food-only",
  "food-and-plate",
  "manual-region",
  "original",
];

function unionBoxes(boxes: NormalizedImageBox[]) {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

export default function ProductImageWorkbench(props: Props) {
  const selectedCandidate =
    props.candidates.find((candidate) => candidate.imagePath === props.selectedSourceImagePath) ||
    props.candidates.find((candidate) => candidate.selected) ||
    props.candidates[0];
  const detectedObjects = useMemo(
    () => selectedCandidate?.detectedObjects || [],
    [selectedCandidate]
  );
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(() =>
    detectedObjects.filter((object) => object.selected).map((object) => object.id)
  );
  const [manualBox, setManualBox] = useState<NormalizedImageBox>({
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.9,
  });
  const [tool, setTool] = useState<"erase" | "restore">("erase");
  const [brushSize, setBrushSize] = useState(0.035);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [editing, setEditing] = useState(false);
  const [manualStatus, setManualStatus] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);

  const selectedGroupBox = useMemo(() => {
    if (props.representation.selectedExtractionScope === "manual-region") return manualBox;
    return unionBoxes(
      detectedObjects
        .filter((object) => selectedObjectIds.includes(object.id))
        .map((object) => object.box)
    );
  }, [detectedObjects, manualBox, props.representation.selectedExtractionScope, selectedObjectIds]);

  async function reprocess(candidate = selectedCandidate) {
    if (!candidate) return;
    await props.onReprocess({
      imagePath: candidate.imagePath,
      representationType: props.representation.type,
      extractionScope: props.representation.selectedExtractionScope,
      selectedObjectIds,
      selectedObjectBoxes: detectedObjects
        .filter((object) => selectedObjectIds.includes(object.id))
        .map((object) => object.box),
      cropBox: selectedGroupBox,
    });
  }

  function addStroke(event: React.PointerEvent<HTMLDivElement>, force = false) {
    if ((!editing && !force) || !stageRef.current || (!force && event.buttons === 0)) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setStrokes((current) => [
      ...current.slice(-298),
      { id: `${Date.now()}-${current.length}`, mode: tool, x, y, radius: brushSize / zoom },
    ]);
    setRedoStrokes([]);
  }

  async function applyManualMask() {
    if (!props.imageState.cutoutImagePath || !strokes.length) return;
    setManualStatus("브러시 수정 내용을 실제 알파 마스크에 적용하는 중입니다.");
    const response = await fetch("/api/image/edit-mask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cutoutImagePath: props.imageState.cutoutImagePath,
        originalImagePath: props.imageState.originalImagePath,
        cropBox: selectedGroupBox,
        strokes,
        representationType: props.representation.type,
        extractionScope: props.representation.selectedExtractionScope,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.resultImagePath) {
      setManualStatus(result.error || "마스크 수정에 실패했습니다.");
      return;
    }
    props.onManualResult(result.resultImagePath, result.quality);
    setStrokes([]);
    setRedoStrokes([]);
    setManualStatus("수동 보정 결과를 누끼 이미지에 적용했습니다.");
  }

  const resultImage = props.imageState.cutoutImagePath;
  return (
    <section className={styles.panel}>
      <div>
        <h3 className={styles.heading}>상품 원본 · 판매 단위 · 누끼</h3>
        <p className={styles.status}>
          첫 이미지 한 장을 확정하지 않고, 원본 품질과 실제 판매 구성 일치도를 따로 비교합니다.
        </p>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <strong>{representationTypeLabel(props.representation.type)}</strong>
          <span className={styles.confidence}>
            신뢰도 {Math.round(props.representation.confidence * 100)}%
          </span>
          <p>{props.representation.reason}</p>
        </div>
        <div className={styles.controlCard}>
          <label>
            상품 표현 유형
            <select
              onChange={(event) =>
                props.onRepresentationChange(event.target.value as ProductRepresentationType)
              }
              value={props.representation.type}
            >
              {representationTypes.map((type) => (
                <option key={type} value={type}>
                  {representationTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            추출 범위
            <select
              onChange={(event) => props.onScopeChange(event.target.value as ProductExtractionScope)}
              value={props.representation.selectedExtractionScope}
            >
              {extractionScopes.map((scope) => (
                <option key={scope} value={scope}>
                  {extractionScopeLabel(scope)}
                  {scope === props.representation.recommendedExtractionScope ? " · 추천" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div>
        <h4 className={styles.sectionHeading}>원본 후보 {Math.min(6, props.candidates.length)}개</h4>
        <div className={styles.candidateGrid}>
          {props.candidates.slice(0, 6).map((candidate) => {
            const selected = candidate.id === selectedCandidate?.id;
            return (
              <article
                className={`${styles.candidate} ${selected ? styles.candidateSelected : ""}`}
                key={candidate.id}
              >
                <div className={styles.candidateImage}>
                  <img alt={candidate.label} src={candidate.imagePath} />
                </div>
                <div className={styles.candidateMeta}>
                  <strong>{candidate.label}</strong>
                  <span>
                    {candidate.width && candidate.height
                      ? `${candidate.width}×${candidate.height}`
                      : "크기 분석 대기"}
                    {candidate.sourceType ? ` · ${candidate.sourceType}` : ""}
                  </span>
                  <small>{candidate.analysisReason || "상세페이지에서 수집한 원본"}</small>
                  <div className={styles.scoreRow}>
                    <span>원본 품질 {Math.round((candidate.sourceImageQualityScore || 0) * 100)}</span>
                    <span>판매 구성 {Math.round((candidate.salesUnitMatchScore || 0) * 100)}</span>
                  </div>
                </div>
                <div className={styles.candidateActions}>
                  <button
                    className={selected ? styles.primary : ""}
                    onClick={() => props.onSourceChange(candidate)}
                    type="button"
                  >
                    원본 선택
                  </button>
                  <button disabled={props.busy} onClick={() => void reprocess(candidate)} type="button">
                    누끼 미리보기
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {detectedObjects.length ? (
        <div>
          <h4 className={styles.sectionHeading}>감지 객체와 판매 그룹</h4>
          <div className={styles.objectActions}>
            <button
              onClick={() => setSelectedObjectIds(detectedObjects.map((object) => object.id))}
              type="button"
            >
              모두 선택
            </button>
            <button
              onClick={() => setSelectedObjectIds(detectedObjects.slice(0, 1).map((object) => object.id))}
              type="button"
            >
              대표 객체만
            </button>
            <button onClick={() => void reprocess()} type="button">
              선택 객체를 판매 그룹으로 누끼
            </button>
          </div>
          <div className={styles.objectGrid}>
            {detectedObjects.map((object, index) => (
              <button
                className={`${styles.objectButton} ${selectedObjectIds.includes(object.id) ? styles.objectSelected : ""}`}
                key={object.id}
                onClick={() =>
                  setSelectedObjectIds((current) =>
                    current.includes(object.id)
                      ? current.filter((id) => id !== object.id)
                      : [...current, object.id]
                  )
                }
                type="button"
              >
                객체 {index + 1} · {Math.round(object.confidence * 100)}%
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {props.representation.selectedExtractionScope === "manual-region" ? (
        <div className={styles.manualControls}>
          <h4 className={styles.sectionHeading}>직접 사각 영역 선택</h4>
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key}>
              {key} {Math.round(manualBox[key] * 100)}%
              <input
                max={key === "x" || key === "y" ? 95 : 100}
                min={key === "width" || key === "height" ? 5 : 0}
                onChange={(event) =>
                  setManualBox((current) => ({
                    ...current,
                    [key]: Number(event.target.value) / 100,
                  }))
                }
                type="range"
                value={Math.round(manualBox[key] * 100)}
              />
            </label>
          ))}
          <button className={styles.primary} disabled={props.busy} onClick={() => void reprocess()} type="button">
            선택 영역으로 다시 누끼
          </button>
        </div>
      ) : null}

      <div className={styles.actionRow}>
        <button className={styles.primary} disabled={props.busy} onClick={() => void reprocess()} type="button">
          {props.busy ? "처리 중…" : "현재 설정으로 다시 누끼"}
        </button>
        <label>
          <input
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => props.onUpload(event.target.files?.[0])}
            type="file"
          />
          <span>원본 직접 업로드</span>
        </label>
        <button onClick={props.onUseOriginal} type="button">원본으로 되돌리기</button>
        <button disabled={!resultImage} onClick={props.onUseCutout} type="button">누끼 결과 적용</button>
      </div>
      <p className={`${styles.status} ${props.imageState.quality?.usable === false ? styles.warning : ""}`}>
        {props.statusMessage}
        {props.imageState.quality
          ? ` · 품질 ${Math.round(props.imageState.quality.score * 100)}점${props.imageState.quality.warnings.length ? ` · ${props.imageState.quality.warnings.join(" ")}` : ""}`
          : ""}
      </p>

      {resultImage ? (
        <div>
          <h4 className={styles.sectionHeading}>배경별 누끼 비교</h4>
          <div className={styles.comparisonGrid}>
            <div className={styles.preview}>
              <div className={`${styles.previewSurface} ${styles.checker}`}><img alt="체크보드 누끼" src={resultImage} /></div>
              <span>투명 체크보드</span>
            </div>
            <div className={styles.preview}>
              <div className={styles.previewSurface}><img alt="흰 배경 누끼" src={resultImage} /></div>
              <span>흰 배경</span>
            </div>
            <div className={styles.preview}>
              <div className={`${styles.previewSurface} ${styles.black}`}><img alt="검은 배경 누끼" src={resultImage} /></div>
              <span>검은 배경</span>
            </div>
            <div className={styles.preview}>
              <div
                className={styles.previewSurface}
                style={{ backgroundImage: props.recommendedBackgroundPath ? `url(${props.recommendedBackgroundPath})` : "linear-gradient(145deg,#dce8f3,#758da4)" }}
              ><img alt="추천 배경 합성" src={resultImage} /></div>
              <span>현재 추천 배경</span>
            </div>
          </div>
        </div>
      ) : null}

      {resultImage ? (
        <details>
          <summary>수동 마스크 보정(데스크톱 권장)</summary>
          <div className={styles.toolbar}>
            <button className={tool === "erase" ? styles.primary : ""} onClick={() => setTool("erase")} type="button">지우기</button>
            <button className={tool === "restore" ? styles.primary : ""} onClick={() => setTool("restore")} type="button">복원</button>
            <button onClick={() => { const last = strokes.at(-1); if (last) { setStrokes((current) => current.slice(0, -1)); setRedoStrokes((current) => [...current, last]); } }} type="button">실행 취소</button>
            <button onClick={() => { const last = redoStrokes.at(-1); if (last) { setRedoStrokes((current) => current.slice(0, -1)); setStrokes((current) => [...current, last]); } }} type="button">다시 실행</button>
            <button onClick={() => { setStrokes([]); setRedoStrokes([]); }} type="button">자동 결과로 초기화</button>
          </div>
          <div className={styles.manualEditor}>
            <div
              className={styles.editStage}
              onPointerDown={(event) => { setEditing(true); event.currentTarget.setPointerCapture(event.pointerId); addStroke(event, true); }}
              onPointerMove={addStroke}
              onPointerUp={() => setEditing(false)}
              ref={stageRef}
            >
              <img alt="마스크 수동 보정" src={resultImage} style={{ transform: `scale(${zoom})` }} />
              {strokes.slice(-80).map((stroke) => (
                <span
                  className={styles.strokeDot}
                  key={stroke.id}
                  style={{ color: stroke.mode === "erase" ? "#e43b45" : "#16a765", height: `${stroke.radius * 100}%`, left: `${stroke.x * 100}%`, top: `${stroke.y * 100}%`, width: `${stroke.radius * 100}%` }}
                />
              ))}
            </div>
            <div className={styles.manualControls}>
              <label>브러시 크기 {Math.round(brushSize * 100)}%<input max="12" min="1" onChange={(event) => setBrushSize(Number(event.target.value) / 100)} type="range" value={Math.round(brushSize * 100)} /></label>
              <label>확대 {zoom.toFixed(1)}×<input max="3" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.1" type="range" value={zoom} /></label>
              <button className={styles.primary} disabled={!strokes.length} onClick={() => void applyManualMask()} type="button">수정 결과 적용</button>
              <button onClick={() => { setStrokes([]); setRedoStrokes([]); setManualStatus("수정을 취소했습니다."); }} type="button">수정 취소</button>
              {manualStatus ? <p className={styles.status}>{manualStatus}</p> : null}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

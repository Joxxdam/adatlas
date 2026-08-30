"use client";

import Image from "next/image";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { nativeReferenceCategoryGroups, nativeReferenceCategoryLabel, nativeReferenceFoodSubcategoryLabel, nativeReferenceCompatibilityConfidences, nativeReferenceCompositionTypes, nativeReferencePhotographyTypes, nativeReferenceProductForms, nativeReferenceSlotShapes, nativeReferenceTextDensities, type ManagedNativeReferenceItem, type NativeReferenceCategoryGroup, type NativeReferenceFoodSubcategory } from "../../lib/creative-generation/referenceLibraryManagement";
import styles from "./NativeReferenceLibraryManager.module.css";

type LibraryPayload = {
  version: string;
  updatedAt: string;
  items: ManagedNativeReferenceItem[];
  counts: Record<NativeReferenceCategoryGroup, number>;
  foodSnackCount: number;
};

type Props = { initialLibrary: LibraryPayload };
type Filter = "all" | NativeReferenceCategoryGroup | "food-snack";
type ReferenceMetadataPatch = Omit<Partial<ManagedNativeReferenceItem>, "foodSubcategory"> & {
  foodSubcategory?: NativeReferenceFoodSubcategory | null;
};
type OcrStatusPayload = {
  run: null | {
    id: string;
    status: "running" | "completed" | "partial" | "cancelled";
    targetIds: string[];
    completedIds: string[];
    readyIds: string[];
    reviewIds: string[];
    failedIds: string[];
    currentIds: string[];
  };
  counts: { totalCount: number; readyCount: number; reviewCount: number; unavailableCount: number; pendingCount: number };
  codexGate: { activeCount: number; pendingCount: number };
};

async function parseResponse(response: Response) {
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result as { library: LibraryPayload; message?: string; added?: ManagedNativeReferenceItem[] };
}

export function NativeReferenceLibraryManager({ initialLibrary }: Props) {
  const [library, setLibrary] = useState(initialLibrary);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copyDrafts, setCopyDrafts] = useState<Record<string, string>>({});
  const [ocrStatus, setOcrStatus] = useState<OcrStatusPayload | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ocrAutoStartRequested = useRef(false);
  const ocrLibrarySignature = useRef("");

  const visibleItems = useMemo(() => library.items.filter((item) => filter === "all" || (filter === "food-snack" ? item.categoryGroup === "food" && item.foodSubcategory === "snack" : item.categoryGroup === filter)).sort((left, right) => right.ordinal - left.ordinal), [filter, library.items]);
  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    async function refreshLibrary() {
      const response = await fetch("/api/admin/references", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok && mounted) setLibrary(payload.library as LibraryPayload);
    }
    async function poll() {
      try {
        const response = await fetch("/api/admin/references/ocr", { cache: "no-store" });
        const payload = await response.json() as OcrStatusPayload & { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "OCR 상태를 확인하지 못했습니다.");
        if (!mounted) return;
        setOcrStatus(payload);
        const signature = `${payload.counts.readyCount}:${payload.counts.reviewCount}:${payload.counts.unavailableCount}:${payload.counts.pendingCount}`;
        if (ocrLibrarySignature.current && ocrLibrarySignature.current !== signature) void refreshLibrary();
        ocrLibrarySignature.current = signature;
        if (payload.counts.pendingCount > 0 && payload.run?.status !== "running" && !ocrAutoStartRequested.current) {
          ocrAutoStartRequested.current = true;
          const startResponse = await fetch("/api/admin/references/ocr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          });
          const started = await startResponse.json() as OcrStatusPayload & { ok?: boolean; error?: string };
          if (!startResponse.ok || !started.ok) throw new Error(started.error || "전체 OCR을 시작하지 못했습니다.");
          if (mounted) {
            setOcrStatus(started);
            setMessage(`미분석 레퍼런스 ${started.run?.targetIds.length || payload.counts.pendingCount}장의 정밀 OCR을 자동 시작했습니다.`);
          }
        }
      } catch (pollError) {
        if (mounted) setError(pollError instanceof Error ? pollError.message : "OCR 상태를 확인하지 못했습니다.");
      } finally {
        if (mounted) timer = window.setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setBusy("upload");
    setError("");
    setMessage(`${files.length}장 업로드 및 상품군 자동 분류 중입니다.`);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const result = await parseResponse(
        await fetch("/api/admin/references", {
          method: "POST",
          body: formData,
        })
      );
      setLibrary(result.library);
      setMessage(`${result.added?.length || 0}장을 등록하고 정밀 OCR 대기열에 자동 추가했습니다.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "업로드에 실패했습니다.");
      setMessage("업로드를 완료하지 못했습니다.");
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    void upload(Array.from(event.target.files || []));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void upload(Array.from(event.dataTransfer.files || []));
  }

  async function updateCategory(item: ManagedNativeReferenceItem, categoryGroup: NativeReferenceCategoryGroup) {
    await updateMetadata(item, { categoryGroup }, `${nativeReferenceCategoryLabel(categoryGroup)} 상품군으로 옮겼습니다.`);
  }

  async function updateMetadata(item: ManagedNativeReferenceItem, patch: ReferenceMetadataPatch, successMessage = "고급 호환 태그를 저장했습니다.") {
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(
        await fetch("/api/admin/references", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, ...patch }),
        })
      );
      setLibrary(result.library);
      setMessage(`${item.sourceFile}: ${successMessage}`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "레퍼런스 호환 정보 수정에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item: ManagedNativeReferenceItem) {
    if (!window.confirm(`${item.sourceFile}을(를) 제작 레퍼런스에서 삭제할까요?\n삭제 즉시 새 작업의 무작위 추첨 대상에서 제외됩니다.`)) return;
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(
        await fetch("/api/admin/references", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        })
      );
      setLibrary(result.library);
      setMessage(result.message || "삭제한 이미지를 제작 추첨 대상에서 제외했습니다.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "삭제에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function saveNativeCopy(item: ManagedNativeReferenceItem, useForCopyAdaptation = item.nativeCopy?.useForCopyAdaptation !== false) {
    const rawText = copyDrafts[item.id] ?? item.nativeCopy?.rawText ?? "";
    await updateMetadata(
      item,
      { nativeCopy: { ...(item.nativeCopy || {}), rawText, useForCopyAdaptation } } as ReferenceMetadataPatch,
      useForCopyAdaptation ? "원문 문구를 저장하고 제작 문구 적응에 사용합니다." : "원문 문구를 저장하고 문구 적응 대상에서는 제외했습니다."
    );
  }

  async function reanalyzeNativeCopy(item: ManagedNativeReferenceItem) {
    if (!window.confirm(`${item.sourceFile}의 문구를 이미지에서 다시 읽을까요?\n수동으로 고친 원문은 새 분석 결과로 교체됩니다.`)) return;
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(
        await fetch("/api/admin/references", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        })
      );
      setLibrary(result.library);
      setCopyDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setMessage(`${item.sourceFile}: 이미지의 문구를 다시 분석했습니다.`);
    } catch (reanalyzeError) {
      setError(reanalyzeError instanceof Error ? reanalyzeError.message : "문구 재분석에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function setNativeCopyApproval(item: ManagedNativeReferenceItem, action: "approve" | "reject") {
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(
        await fetch("/api/admin/references", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, nativeCopyApproval: action }),
        })
      );
      setLibrary(result.library);
      setMessage(`${item.sourceFile}: ${action === "approve" ? "정밀 분석을 승인해 제작 우선 풀에 반영했습니다." : "분석을 반려해 문구 적응 대상에서 제외했습니다."}`);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "분석 승인 상태를 변경하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function startOcr(action: "start" | "retry-failed" = "start") {
    if (busy) return;
    setBusy("analysis-batch");
    setError("");
    setMessage(action === "retry-failed" ? "검수·실패 항목의 정밀 OCR을 다시 시작합니다." : "미분석 레퍼런스 전체의 정밀 OCR을 시작합니다.");
    try {
      const response = await fetch("/api/admin/references/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      const result = await response.json() as OcrStatusPayload & { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "정밀 OCR을 시작하지 못했습니다.");
      setOcrStatus(result);
      ocrAutoStartRequested.current = true;
      setMessage(`정밀 OCR을 백그라운드에서 처리합니다. 완료 ${result.run?.completedIds.length || 0}/${result.run?.targetIds.length || 0}장입니다.`);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "미분석 레퍼런스 정밀 분석에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function cancelOcr() {
    if (busy) return;
    setBusy("analysis-batch");
    setError("");
    try {
      const response = await fetch("/api/admin/references/ocr", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const result = await response.json() as OcrStatusPayload & { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "정밀 OCR을 중단하지 못했습니다.");
      setOcrStatus(result);
      setMessage("정밀 OCR을 중단했습니다. 이미 저장된 분석 결과는 유지됩니다.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "정밀 OCR을 중단하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.library} aria-labelledby="native-reference-title">
      <div className={styles.summary}>
        <div>
          <h2 id="native-reference-title">광고 제작 레퍼런스</h2>
          <span>등록된 이미지만 수동·자동 광고 제작에 사용됩니다.</span>
        </div>
        <strong>
          {library.items.length}
          <small>장 사용 중</small>
        </strong>
      </div>

      <div className={styles.uploader} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <div>
          <strong>{busy === "upload" ? "업로드하고 자동 분류하는 중입니다" : "새 레퍼런스 이미지 추가"}</strong>
          <span>JPEG·PNG·WebP, 장당 15MB 이하 · 한 번에 최대 12장</span>
        </div>
        <input accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} multiple onChange={handleFiles} ref={fileInput} type="file" />
        <div className={styles.uploaderActions}>
          <button disabled={Boolean(busy)} onClick={() => fileInput.current?.click()} type="button">
            {busy === "upload" ? "자동 분류 중…" : "이미지 업로드"}
          </button>
          {ocrStatus?.run?.status === "running" ? (
            <button className={styles.analysisButton} disabled={Boolean(busy)} onClick={() => void cancelOcr()} type="button">
              {busy === "analysis-batch" ? "처리 중…" : "전체 OCR 중지"}
            </button>
          ) : (
            <button
              className={styles.analysisButton}
              disabled={Boolean(busy) || (!ocrStatus?.counts.pendingCount && !ocrStatus?.run?.failedIds.length && !ocrStatus?.run?.reviewIds.length)}
              onClick={() => void startOcr(ocrStatus?.run?.failedIds.length || ocrStatus?.run?.reviewIds.length ? "retry-failed" : "start")}
              type="button"
            >
              {busy === "analysis-batch" ? "처리 중…" : ocrStatus?.run?.failedIds.length || ocrStatus?.run?.reviewIds.length ? "검수·실패 항목 다시 분석" : `미분석 전체 OCR (${ocrStatus?.counts.pendingCount || 0})`}
            </button>
          )}
        </div>
      </div>

      {ocrStatus ? (
        <div className={styles.status} role="status">
          정밀 OCR · 사용 가능 {ocrStatus.counts.readyCount}/{ocrStatus.counts.totalCount}장 · 검수 {ocrStatus.counts.reviewCount}장 · 실패 {ocrStatus.counts.unavailableCount}장 · 미분석 {ocrStatus.counts.pendingCount}장
          {ocrStatus.run?.status === "running" ? ` · 이번 실행 ${ocrStatus.run.completedIds.length}/${ocrStatus.run.targetIds.length}장 완료 · 현재 ${ocrStatus.run.currentIds.length}장 처리 중` : ""}
        </div>
      ) : null}

      {error || message ? (
        <div className={error ? styles.statusError : styles.status} role={error ? "alert" : "status"}>
          {error || message}
        </div>
      ) : null}

      <div className={styles.filters} aria-label="레퍼런스 상품군 필터">
        <button className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")} type="button">
          전체 <b>{library.items.length}</b>
        </button>
        {nativeReferenceCategoryGroups.map((categoryGroup) => (
          <button className={filter === categoryGroup ? styles.active : ""} key={categoryGroup} onClick={() => setFilter(categoryGroup)} type="button">
            {nativeReferenceCategoryLabel(categoryGroup)} <b>{library.counts[categoryGroup] || 0}</b>
          </button>
        ))}
        <button className={`${filter === "food-snack" ? styles.active : ""} ${styles.produceFilter}`.trim()} onClick={() => setFilter("food-snack")} type="button">
          ↳ 간식 <b>{library.foodSnackCount || 0}</b>
        </button>
      </div>

      {visibleItems.length ? (
        <div className={styles.grid}>
          {visibleItems.map((item) => (
            <article className={styles.card} key={item.id}>
              <div className={styles.imageFrame}>
                <Image alt={`${nativeReferenceCategoryLabel(item.categoryGroup)} 광고 레퍼런스`} fill sizes="(max-width: 760px) 50vw, 220px" src={item.publicPath} />
                <span>
                  {nativeReferenceCategoryLabel(item.categoryGroup)}
                  {item.foodSubcategory ? ` · ${nativeReferenceFoodSubcategoryLabel(item.foodSubcategory)}` : ""}
                </span>
              </div>
              <div className={styles.cardBody}>
                <strong title={item.sourceFile}>{item.sourceFile}</strong>
                <details className={styles.managePanel}>
                  <summary>
                    <span>분류 및 설정</span>
                    <small>{nativeReferenceCategoryLabel(item.categoryGroup)}</small>
                  </summary>
                  <div className={styles.settingsBody}>
                    <label>
                      상품군
                      <select disabled={Boolean(busy)} onChange={(event) => void updateCategory(item, event.target.value as NativeReferenceCategoryGroup)} value={item.categoryGroup}>
                        {nativeReferenceCategoryGroups.map((categoryGroup) => (
                          <option key={categoryGroup} value={categoryGroup}>
                            {nativeReferenceCategoryLabel(categoryGroup)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {item.categoryGroup === "food" ? (
                      <label className={styles.produceToggle}>
                        <input checked={item.foodSubcategory === "snack"} disabled={Boolean(busy)} onChange={(event) => void updateMetadata(item, { foodSubcategory: event.target.checked ? "snack" : null }, event.target.checked ? "간식 전용 선택 풀에도 추가했습니다." : "간식 전용 선택 풀에서 제외했습니다.")} type="checkbox" />
                        <span>간식 레퍼런스로도 사용</span>
                      </label>
                    ) : null}
                    <details className={styles.nativeCopy} open={!item.nativeCopy?.rawText}>
                      <summary>
                        실제 광고 원문
                        <small>
                          {item.nativeCopy?.approvalStatus === "auto-approved" || item.nativeCopy?.approvalStatus === "manually-approved"
                            ? "승인됨"
                            : item.nativeCopy?.approvalStatus === "rejected"
                              ? "제외됨"
                              : "확인 필요"}
                        </small>
                      </summary>
                      <p>이미지에 보이는 줄바꿈·기호·말투를 그대로 보관합니다. 생성할 때 이 원문에서 상품 관련 부분만 바꿉니다.</p>
                      <div className={styles.analysisMeta}>
                        <span>상태 <b>{item.nativeCopy?.analysisStatus === "ready" ? "사용 가능" : item.nativeCopy?.analysisStatus === "unavailable" ? "분석 불가" : "검수 필요"}</b></span>
                        <span>신뢰도 <b>{typeof item.nativeCopy?.confidence === "number" ? `${Math.round(item.nativeCopy.confidence * 100)}%` : "-"}</b></span>
                        <span>영역 <b>{item.nativeCopy?.textRegions?.length || 0}개</b></span>
                      </div>
                      {item.nativeCopy?.analysisError ? <div className={styles.analysisWarning}>{item.nativeCopy.analysisError}</div> : null}
                      {item.nativeCopy?.textRegions?.some((region) => region.box) ? (
                        <details className={styles.regionReview}>
                          <summary>문구 위치·교체 정책 검수</summary>
                          <div className={styles.analysisPreview}>
                            <Image alt="문구 영역 검수용 레퍼런스" fill sizes="220px" src={item.publicPath} />
                            {item.nativeCopy.textRegions.map((region, regionIndex) => region.box ? (
                              <span
                                className={`${styles.regionBox} ${region.reviewRequired ? styles.regionBoxWarning : ""}`.trim()}
                                key={region.id}
                                style={{ left: `${region.box.x * 100}%`, top: `${region.box.y * 100}%`, width: `${region.box.width * 100}%`, height: `${region.box.height * 100}%` }}
                                title={`${region.role} · ${region.sourceType || "ad-copy"} · ${region.replacePolicy || "adapt"}: ${region.text}`}
                              >
                                {regionIndex + 1}
                              </span>
                            ) : null)}
                          </div>
                          <ol className={styles.regionList}>
                            {item.nativeCopy.textRegions.map((region) => (
                              <li key={region.id}>
                                <b>{region.readingOrder ?? "-"}. {region.role}</b>
                                <span>{region.sourceType || "ad-copy"} · {region.replacePolicy || "adapt"} · {typeof region.confidence === "number" ? `${Math.round(region.confidence * 100)}%` : "신뢰도 -"}</span>
                                <em>{region.text || "(텍스트 없음)"}</em>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                      <textarea
                        disabled={Boolean(busy)}
                        onChange={(event) => setCopyDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                        rows={7}
                        value={copyDrafts[item.id] ?? item.nativeCopy?.rawText ?? ""}
                      />
                      <label className={styles.nativeCopyToggle}>
                        <input
                          checked={item.nativeCopy?.useForCopyAdaptation !== false}
                          disabled={Boolean(busy)}
                          onChange={(event) => void saveNativeCopy(item, event.target.checked)}
                          type="checkbox"
                        />
                        <span>이 원문을 상품 문구 적응에 사용</span>
                      </label>
                      <div className={styles.nativeCopyActions}>
                        <button disabled={Boolean(busy)} onClick={() => void saveNativeCopy(item)} type="button">원문 저장</button>
                        <button disabled={Boolean(busy)} onClick={() => void reanalyzeNativeCopy(item)} type="button">이미지에서 다시 읽기</button>
                        <button disabled={Boolean(busy) || !item.nativeCopy?.rawLines?.some((line) => line.trim())} onClick={() => void setNativeCopyApproval(item, "approve")} type="button">검수 승인</button>
                        <button disabled={Boolean(busy)} onClick={() => void setNativeCopyApproval(item, "reject")} type="button">문구 사용 제외</button>
                      </div>
                    </details>
                    <details className={styles.advanced}>
                      <summary>고급 호환 태그</summary>
                      <label>
                        상품 형태
                        <select disabled={Boolean(busy)} value={item.productForm} onChange={(event) => void updateMetadata(item, { productForm: event.target.value as ManagedNativeReferenceItem["productForm"] })}>
                          {nativeReferenceProductForms.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        구성 유형
                        <select disabled={Boolean(busy)} value={item.compositionType} onChange={(event) => void updateMetadata(item, { compositionType: event.target.value as ManagedNativeReferenceItem["compositionType"] })}>
                          {nativeReferenceCompositionTypes.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        상품 슬롯 수
                        <select disabled={Boolean(busy)} value={item.productSlotCount || 1} onChange={(event) => void updateMetadata(item, { productSlotCount: Number(event.target.value) })}>
                          {[1, 2, 3, 4, 5, 6].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        슬롯 형태
                        <select disabled={Boolean(busy)} value={item.productSlotShape} onChange={(event) => void updateMetadata(item, { productSlotShape: event.target.value as ManagedNativeReferenceItem["productSlotShape"] })}>
                          {nativeReferenceSlotShapes.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        사진 유형
                        <select disabled={Boolean(busy)} value={item.photographyType} onChange={(event) => void updateMetadata(item, { photographyType: event.target.value as ManagedNativeReferenceItem["photographyType"] })}>
                          {nativeReferencePhotographyTypes.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        문구 밀도
                        <select disabled={Boolean(busy)} value={item.textDensity} onChange={(event) => void updateMetadata(item, { textDensity: event.target.value as ManagedNativeReferenceItem["textDensity"] })}>
                          {nativeReferenceTextDensities.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        태그 신뢰도
                        <select disabled={Boolean(busy)} value={item.compatibilityConfidence} onChange={(event) => void updateMetadata(item, { compatibilityConfidence: event.target.value as ManagedNativeReferenceItem["compatibilityConfidence"] })}>
                          {nativeReferenceCompatibilityConfidences.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(
                        [
                          ["supportsPackagedProduct", "포장 상품"],
                          ["supportsNaturalFood", "자연 식품"],
                          ["supportsHumanModel", "사람 모델"],
                          ["supportsMultipleProducts", "복수 상품"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <select disabled={Boolean(busy)} value={item[key] ? "true" : "false"} onChange={(event) => void updateMetadata(item, { [key]: event.target.value === "true" })}>
                            <option value="true">지원</option>
                            <option value="false">미지원</option>
                          </select>
                        </label>
                      ))}
                    </details>
                    <button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void remove(item)} type="button">
                      {busy === item.id ? "처리 중…" : "레퍼런스 삭제"}
                    </button>
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>이 상품군에 등록된 레퍼런스가 없습니다.</div>
      )}
    </section>
  );
}

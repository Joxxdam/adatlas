"use client";

import Image from "next/image";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import {
  nativeReferenceCategoryGroups,
  nativeReferenceCategoryLabel,
  type ManagedNativeReferenceItem,
  type NativeReferenceCategoryGroup,
} from "../../lib/creative-generation/referenceLibraryManagement";
import styles from "./NativeReferenceLibraryManager.module.css";

type LibraryPayload = {
  version: string;
  updatedAt: string;
  items: ManagedNativeReferenceItem[];
  counts: Record<NativeReferenceCategoryGroup, number>;
};

type Props = { initialLibrary: LibraryPayload };
type Filter = "all" | NativeReferenceCategoryGroup;

async function parseResponse(response: Response) {
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result as { library: LibraryPayload; message?: string; added?: ManagedNativeReferenceItem[] };
}

export function NativeReferenceLibraryManager({ initialLibrary }: Props) {
  const [library, setLibrary] = useState(initialLibrary);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("이 화면에 있는 이미지만 수동·자동 광고 제작의 무작위 레퍼런스로 사용됩니다.");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const visibleItems = useMemo(
    () => library.items
      .filter((item) => filter === "all" || item.categoryGroup === filter)
      .sort((left, right) => right.ordinal - left.ordinal),
    [filter, library.items]
  );

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setBusy("upload");
    setError("");
    setMessage(`${files.length}장 업로드 및 상품군 자동 분류 중입니다.`);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const result = await parseResponse(await fetch("/api/admin/references", {
        method: "POST",
        body: formData,
      }));
      setLibrary(result.library);
      setMessage(`${result.added?.length || 0}장을 등록했습니다. 이후 새 수동·자동 제작부터 바로 사용합니다.`);
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
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(await fetch("/api/admin/references", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, categoryGroup }),
      }));
      setLibrary(result.library);
      setMessage(`${item.sourceFile}을(를) ${nativeReferenceCategoryLabel(categoryGroup)}으로 옮겼습니다.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "카테고리 수정에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item: ManagedNativeReferenceItem) {
    if (!window.confirm(`${item.sourceFile}을(를) 제작 레퍼런스에서 삭제할까요?\n삭제 즉시 새 작업의 무작위 추첨 대상에서 제외됩니다.`)) return;
    setBusy(item.id);
    setError("");
    try {
      const result = await parseResponse(await fetch("/api/admin/references", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      }));
      setLibrary(result.library);
      setMessage(result.message || "삭제한 이미지를 제작 추첨 대상에서 제외했습니다.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "삭제에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.library} aria-labelledby="native-reference-title">
      <div className={styles.summary}>
        <div>
          <p>PRODUCTION REFERENCE LIBRARY</p>
          <h2 id="native-reference-title">광고 제작 레퍼런스</h2>
          <span>업로드하면 광고 속 상품을 보고 패션·식품·화장품 중 하나로 자동 정리합니다.</span>
        </div>
        <strong>{library.items.length}<small>장 사용 중</small></strong>
      </div>

      <div
        className={styles.uploader}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <div>
          <strong>{busy === "upload" ? "업로드하고 자동 분류하는 중입니다" : "새 레퍼런스 이미지 추가"}</strong>
          <span>JPEG·PNG·WebP, 장당 15MB 이하 · 한 번에 최대 12장</span>
        </div>
        <input
          accept="image/jpeg,image/png,image/webp"
          disabled={Boolean(busy)}
          multiple
          onChange={handleFiles}
          ref={fileInput}
          type="file"
        />
        <button disabled={Boolean(busy)} onClick={() => fileInput.current?.click()} type="button">
          {busy === "upload" ? "자동 분류 중…" : "이미지 업로드"}
        </button>
      </div>

      <div className={error ? styles.statusError : styles.status} role={error ? "alert" : "status"}>
        {error || message}
      </div>

      <div className={styles.filters} aria-label="레퍼런스 상품군 필터">
        <button className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")} type="button">
          전체 <b>{library.items.length}</b>
        </button>
        {nativeReferenceCategoryGroups.map((categoryGroup) => (
          <button
            className={filter === categoryGroup ? styles.active : ""}
            key={categoryGroup}
            onClick={() => setFilter(categoryGroup)}
            type="button"
          >
            {nativeReferenceCategoryLabel(categoryGroup)} <b>{library.counts[categoryGroup] || 0}</b>
          </button>
        ))}
      </div>

      {visibleItems.length ? (
        <div className={styles.grid}>
          {visibleItems.map((item) => (
            <article className={styles.card} key={item.id}>
              <div className={styles.imageFrame}>
                <Image alt={`${nativeReferenceCategoryLabel(item.categoryGroup)} 광고 레퍼런스`} fill sizes="(max-width: 760px) 50vw, 220px" src={item.publicPath} />
                <span>{nativeReferenceCategoryLabel(item.categoryGroup)}</span>
              </div>
              <div className={styles.cardBody}>
                <strong title={item.sourceFile}>{item.sourceFile}</strong>
                <label>
                  상품군
                  <select
                    disabled={Boolean(busy)}
                    onChange={(event) => void updateCategory(item, event.target.value as NativeReferenceCategoryGroup)}
                    value={item.categoryGroup}
                  >
                    {nativeReferenceCategoryGroups.map((categoryGroup) => (
                      <option key={categoryGroup} value={categoryGroup}>{nativeReferenceCategoryLabel(categoryGroup)}</option>
                    ))}
                  </select>
                </label>
                <button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void remove(item)} type="button">
                  {busy === item.id ? "처리 중…" : "삭제"}
                </button>
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


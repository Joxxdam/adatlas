"use client";

/* eslint-disable @next/next/no-img-element -- managed local WebP previews */

import { useEffect, useMemo, useState } from "react";

import type { BackgroundLibraryItem } from "../../../lib/background-library/types";

import styles from "./BackgroundLibraryManager.module.css";

type FilterState = {
  category: string;
  subcategory: string;
  ageGroup: string;
  person: string;
  contentType: string;
  query: string;
};

const initialFilters: FilterState = {
  category: "",
  subcategory: "",
  ageGroup: "",
  person: "",
  contentType: "",
  query: "",
};

function contentLabel(item: BackgroundLibraryItem) {
  return ["lifestyle_photo", "people_photo"].includes(item.assetType) ? "실사형" : "콘텐츠형";
}

export function BackgroundLibraryManager() {
  const [items, setItems] = useState<BackgroundLibraryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [status, setStatus] = useState("배경 라이브러리를 불러오는 중입니다.");
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/background-library/manage", { cache: "no-store" });
      const result = (await response.json()) as {
        ok?: boolean;
        items?: BackgroundLibraryItem[];
        categories?: string[];
        error?: string;
      };
      if (!response.ok || !result.ok) throw new Error(result.error || "배경을 불러오지 못했습니다.");
      setItems(result.items || []);
      setCategories(result.categories || []);
      setStatus(`정상 배경 ${result.items?.length || 0}개를 불러왔습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "배경을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/background-library/manage", { cache: "no-store" })
      .then(async (response) => ({
        response,
        result: (await response.json()) as {
          ok?: boolean;
          items?: BackgroundLibraryItem[];
          categories?: string[];
          error?: string;
        },
      }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok || !result.ok) throw new Error(result.error || "배경을 불러오지 못했습니다.");
        setItems(result.items || []);
        setCategories(result.categories || []);
        setStatus(`정상 배경 ${result.items?.length || 0}개를 불러왔습니다.`);
      })
      .catch((error: unknown) => {
        if (active) setStatus(error instanceof Error ? error.message : "배경을 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, []);

  const subcategories = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.subcategories))).sort(),
    [items]
  );
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return items.filter((item) => {
      if (filters.category && item.category !== filters.category) return false;
      if (filters.subcategory && !item.subcategories.includes(filters.subcategory)) return false;
      if (filters.ageGroup && !item.ageGroups.includes(filters.ageGroup as never)) return false;
      if (filters.person === "yes" && !item.includesPerson) return false;
      if (filters.person === "no" && item.includesPerson) return false;
      if (filters.contentType && contentLabel(item) !== filters.contentType) return false;
      if (
        query &&
        ![
          item.id,
          item.scene,
          ...item.subcategories,
          ...item.mood,
          ...item.elements,
          ...item.colors,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
        return false;
      return true;
    });
  }, [filters, items]);

  async function patchItem(id: string, changes: Partial<BackgroundLibraryItem>) {
    setBusy(true);
    try {
      const response = await fetch("/api/background-library/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, changes }),
      });
      const result = (await response.json()) as { ok?: boolean; item?: BackgroundLibraryItem; error?: string };
      if (!response.ok || !result.ok || !result.item) throw new Error(result.error || "수정에 실패했습니다.");
      setItems((current) => current.map((item) => (item.id === id ? result.item! : item)));
      setStatus("배경 메타데이터를 저장했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "수정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(item: BackgroundLibraryItem) {
    if (!window.confirm(`'${item.scene}' 배경 파일과 메타데이터를 삭제할까요?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/background-library/manage?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "삭제에 실패했습니다.");
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setStatus("배경을 삭제했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const category = newCategory.trim().toLowerCase();
    if (!category) return;
    setBusy(true);
    try {
      const response = await fetch("/api/background-library/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-category", category }),
      });
      const result = (await response.json()) as { ok?: boolean; categories?: string[]; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "카테고리 추가에 실패했습니다.");
      setCategories(result.categories || categories);
      setNewCategory("");
      setStatus("새 카테고리 폴더를 추가했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "카테고리 추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBackground(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/background-library/manage", { method: "POST", body: form });
      const result = (await response.json()) as { ok?: boolean; item?: BackgroundLibraryItem; error?: string };
      if (!response.ok || !result.ok || !result.item) throw new Error(result.error || "업로드에 실패했습니다.");
      setItems((current) => [result.item!, ...current]);
      event.currentTarget.reset();
      setStatus("이미지를 1600×1600 WebP로 최적화해 저장했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.manager}>
      <header>
        <div>
          <p>BACKGROUND LIBRARY</p>
          <h3>배경 라이브러리 관리</h3>
          <span>{status}</span>
        </div>
        <button disabled={busy} onClick={() => void load()} type="button">새로고침</button>
      </header>

      <details className={styles.addPanel}>
        <summary>새 배경 또는 카테고리 추가</summary>
        <div className={styles.categoryCreator}>
          <input
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="새 카테고리 (예: outdoor)"
            value={newCategory}
          />
          <button disabled={busy || !newCategory.trim()} onClick={() => void addCategory()} type="button">카테고리 추가</button>
        </div>
        <form className={styles.uploadForm} onSubmit={uploadBackground}>
          <label>이미지 파일<input accept="image/png,image/jpeg,image/webp,image/avif" name="file" required type="file" /></label>
          <label>카테고리<select name="category" required>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>장면 이름<input name="scene" placeholder="자연광이 드는 정돈된 주방" required /></label>
          <label>세부 카테고리<input name="subcategories" placeholder="kitchen, home" /></label>
          <label>후킹 태그<input name="hookTypes" placeholder="situation, convenience" /></label>
          <label>분위기 태그<input name="mood" placeholder="따뜻한, 현실적인" /></label>
          <label>요소 태그<input name="elements" placeholder="table, window-light" /></label>
          <label>색상 태그<input name="colors" placeholder="cream, brown" /></label>
          <label>자산 유형<select name="assetType"><option value="user_uploaded">사용자 업로드</option><option value="lifestyle_photo">실사 공간</option><option value="people_photo">인물 실사</option><option value="product_set">촬영 세트</option><option value="pattern_texture">패턴·텍스처</option><option value="ingredient_scene">원료 장면</option><option value="ai_generated">검수된 AI</option><option value="designed_asset">제작형</option></select></label>
          <label>인물 유무<select name="includesPerson"><option value="false">인물 없음</option><option value="true">인물 있음</option></select></label>
          <label>연령 태그<input name="ageGroups" placeholder="twenties, thirties" /></label>
          <label>문구 영역<select name="textSafeArea"><option>top-left</option><option>top-right</option><option>center-left</option><option>center-right</option><option>bottom-left</option><option>bottom-right</option></select></label>
          <label>상품 영역<select name="productPosition"><option>center-right</option><option>center-left</option><option>bottom-right</option><option>bottom-left</option><option>bottom-center</option><option>center</option></select></label>
          <label>원본 페이지<input name="sourcePageUrl" placeholder="https://..." type="url" /></label>
          <label>라이선스<input name="licenseUrl" placeholder="https://..." type="url" /></label>
          <button disabled={busy} type="submit">최적화 후 저장</button>
        </form>
      </details>

      <div className={styles.filters}>
        <select onChange={(event) => setFilters({ ...filters, category: event.target.value })} value={filters.category}><option value="">전체 카테고리</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
        <select onChange={(event) => setFilters({ ...filters, subcategory: event.target.value })} value={filters.subcategory}><option value="">전체 세부 카테고리</option>{subcategories.map((value) => <option key={value}>{value}</option>)}</select>
        <select onChange={(event) => setFilters({ ...filters, ageGroup: event.target.value })} value={filters.ageGroup}><option value="">전체 연령</option><option>teens</option><option>twenties</option><option>thirties</option><option>forties</option><option>fifties</option><option>senior</option><option>kids</option><option>family</option><option>no_people</option></select>
        <select onChange={(event) => setFilters({ ...filters, person: event.target.value })} value={filters.person}><option value="">인물 전체</option><option value="yes">인물 있음</option><option value="no">인물 없음</option></select>
        <select onChange={(event) => setFilters({ ...filters, contentType: event.target.value })} value={filters.contentType}><option value="">유형 전체</option><option>실사형</option><option>콘텐츠형</option></select>
        <input onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="장면·태그 검색" value={filters.query} />
      </div>

      <p className={styles.resultCount}>표시 {filtered.length}개 / 전체 {items.length}개</p>
      <div className={styles.grid}>
        {filtered.map((item) => (
          <article className={!item.enabled ? styles.disabled : ""} key={item.id}>
            <img alt={item.scene} loading="lazy" onError={(event) => { event.currentTarget.closest("article")?.classList.add(styles.imageError); }} src={item.file} />
            <div className={styles.cardBody}>
              <strong>{item.scene}</strong>
              <span>{item.category} · {contentLabel(item)} · {item.includesPerson ? `${item.peopleCount}명` : "인물 없음"}</span>
              <small>{[...item.ageGroups, ...item.mood].slice(0, 5).join(" · ")}</small>
              <details>
                <summary>메타데이터·출처 수정</summary>
                <label>장면<input defaultValue={item.scene} id={`${item.id}-scene`} /></label>
                <label>태그<input defaultValue={item.elements.join(", ")} id={`${item.id}-tags`} /></label>
                <button disabled={busy} onClick={() => void patchItem(item.id, {
                  scene: (document.getElementById(`${item.id}-scene`) as HTMLInputElement)?.value,
                  elements: ((document.getElementById(`${item.id}-tags`) as HTMLInputElement)?.value || "").split(",").map((value) => value.trim()).filter(Boolean),
                })} type="button">수정 저장</button>
                <span>{item.sourceName} {item.authorName ? `· ${item.authorName}` : ""}</span>
                {item.sourcePageUrl ? <a href={item.sourcePageUrl} rel="noreferrer" target="_blank">원본 페이지</a> : null}
                {item.licenseUrl ? <a href={item.licenseUrl} rel="noreferrer" target="_blank">라이선스</a> : null}
              </details>
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => void patchItem(item.id, { enabled: !item.enabled })} type="button">{item.enabled ? "비활성화" : "활성화"}</button>
                <button className={styles.deleteButton} disabled={busy} onClick={() => void deleteItem(item)} type="button">삭제</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { BigQueryAdvertiser } from "../../lib/bigquery/types";
import { defaultFashionCategories, resolveFashionCategorySelection } from "../../lib/category-candidates/normalization";
import type { CategoryCreativeCopy, CategoryCreativeJob, CategoryCreativeSource, CategoryCreativeStyle } from "../../lib/category-creatives/types";
import styles from "./CategoryCreativeWorkspace.module.css";

type Props = { initialAdvertiserId?: string; initialAdvertiserName?: string; initialCategoryId?: string; initialCategoryName?: string };

const styleOptions: Array<{ value: CategoryCreativeStyle; label: string }> = [
  { value: "auto", label: "자동 추천" }, { value: "editorial", label: "에디토리얼" }, { value: "practical", label: "실용 코디" }, { value: "seasonal", label: "시즌 무드" }, { value: "friendly", label: "친근한 SNS" },
];

export function CategoryCreativeWorkspace(props: Props) {
  const initialCategory = resolveFashionCategorySelection(props.initialCategoryId, props.initialCategoryName);
  const [advertisers, setAdvertisers] = useState<BigQueryAdvertiser[]>([]);
  const [advertiserId, setAdvertiserId] = useState(props.initialAdvertiserId || "");
  const [advertiserName, setAdvertiserName] = useState(props.initialAdvertiserName || "");
  const [categoryId, setCategoryId] = useState(initialCategory.id);
  const [categoryName, setCategoryName] = useState(initialCategory.name);
  const [style, setStyle] = useState<CategoryCreativeStyle>("auto");
  const [sources, setSources] = useState<CategoryCreativeSource[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [representativeId, setRepresentativeId] = useState("");
  const [productName, setProductName] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoWarnings, setAutoWarnings] = useState<string[]>([]);
  const [autoImportedCount, setAutoImportedCount] = useState(0);
  const [autoReloadKey, setAutoReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<CategoryCreativeJob | null>(null);
  const [copy, setCopy] = useState<CategoryCreativeCopy>({ headline: `요즘 ${categoryName}, 이렇게 입어요`, subheadline: "서로 다른 무드를 한 장에서 비교해보세요", cta: "스타일 모아보기" });
  const [message, setMessage] = useState("");

  const selectedAdvertiser = useMemo(() => advertisers.find((item) => item.id === advertiserId), [advertiserId, advertisers]);
  const resolvedAdvertiserName = advertiserName || selectedAdvertiser?.name || "";
  const selectedSources = useMemo(
    () => selectedIds.map((id) => sources.find((source) => source.id === id)).filter((source): source is CategoryCreativeSource => Boolean(source)),
    [selectedIds, sources],
  );

  useEffect(() => {
    fetch("/api/ad-candidates/brands").then((response) => response.json()).then((payload) => {
      if (payload.ok) setAdvertisers(payload.advertisers || payload.rows || []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!advertiserId || !categoryId) {
      return;
    }
    const controller = new AbortController();

    async function prepareProducts() {
      try {
        const response = await fetch("/api/category-creatives/sources/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ advertiserId, advertiserName: resolvedAdvertiserName, categoryId }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "상품 이미지를 자동으로 준비하지 못했습니다.");
        const nextSources = (payload.sources || []) as CategoryCreativeSource[];
        const nextIds = ((payload.selectedSourceIds || []) as string[]).slice(0, 5);
        setSources(nextSources);
        setSelectedIds(nextIds);
        setRepresentativeId((current) => (nextIds.includes(current) ? current : nextIds[0] || ""));
        setAutoWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
        setAutoImportedCount(Number(payload.importedCount || 0));
      } catch (reason) {
        if (controller.signal.aborted) return;
        setAutoWarnings([reason instanceof Error ? reason.message : "상품 이미지를 자동으로 준비하지 못했습니다."]);
        try {
          const response = await fetch(`/api/category-creatives/sources?advertiserId=${encodeURIComponent(advertiserId)}&categoryId=${encodeURIComponent(categoryId)}`, { signal: controller.signal });
          const payload = await response.json();
          if (payload.ok) setSources(payload.sources || []);
        } catch {
          // 직접 업로드 보조 옵션은 그대로 사용할 수 있습니다.
        }
      } finally {
        if (!controller.signal.aborted) setAutoLoading(false);
      }
    }

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setAutoLoading(true);
      setAutoWarnings([]);
      setAutoImportedCount(0);
      setMessage("");
      void prepareProducts();
    });
    return () => controller.abort();
  }, [advertiserId, autoReloadKey, categoryId, resolvedAdvertiserName]);

  function changeAdvertiser(nextId: string) {
    const match = advertisers.find((item) => item.id === nextId);
    setAdvertiserId(nextId); setAdvertiserName(match?.name || ""); setSources([]); setSelectedIds([]); setRepresentativeId(""); setAutoWarnings([]); setJob(null); setMessage("");
    setCopy({ headline: `요즘 ${categoryName}, 이렇게 입어요`, subheadline: "서로 다른 무드를 한 장에서 비교해보세요", cta: "스타일 모아보기" });
  }

  function changeCategory(nextId: string) {
    const match = defaultFashionCategories.find((item) => item.id === nextId);
    const name = match?.name || "미분류";
    setCategoryId(nextId); setCategoryName(name); setSources([]); setSelectedIds([]); setRepresentativeId(""); setAutoWarnings([]); setJob(null); setMessage("");
    setCopy({ headline: `요즘 ${name}, 이렇게 입어요`, subheadline: "서로 다른 무드를 한 장에서 비교해보세요", cta: "스타일 모아보기" });
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    if (!files.length || !advertiserId) return;
    setUploading(true); setMessage("");
    try {
      const uploaded: CategoryCreativeSource[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("file", file); form.set("advertiserId", advertiserId); form.set("advertiserName", resolvedAdvertiserName); form.set("categoryId", categoryId); form.set("categoryName", categoryName); form.set("productName", productName || file.name.replace(/\.[^.]+$/, ""));
        const response = await fetch("/api/category-creatives/sources", { method: "POST", body: form });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "업로드 실패");
        uploaded.push(payload.source);
      }
      setSources((current) => [...uploaded, ...current]);
      setSelectedIds((current) => [...current, ...uploaded.map((source) => source.id)].slice(0, 5));
      if (!representativeId && uploaded[0]) setRepresentativeId(uploaded[0].id);
      setMessage(`${uploaded.length}장 업로드했습니다.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); event.target.value = ""; }
  }

  function toggleSource(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        if (representativeId === id) setRepresentativeId(next[0] || "");
        return next;
      }
      if (current.length >= 5) return current;
      if (!representativeId) setRepresentativeId(id);
      return [...current, id];
    });
  }

  function move(id: string, direction: -1 | 1) {
    setSelectedIds((current) => { const next = [...current]; const index = next.indexOf(id); const target = index + direction; if (index < 0 || target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }

  async function create() {
    setCreating(true); setMessage("");
    try {
      const response = await fetch("/api/category-creatives/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ advertiserId, advertiserName: resolvedAdvertiserName, categoryId, categoryName, style, sourceIds: selectedIds, representativeSourceId: representativeId, copy }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || payload.job?.error || "제작에 실패했습니다.");
      setJob(payload.job); setCopy(payload.job.copy); setMessage("정사각형과 세로형 이미지가 완성되었습니다.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setCreating(false); }
  }

  async function rerenderCopy() {
    if (!job) return;
    setCreating(true);
    try {
      const response = await fetch(`/api/category-creatives/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "문구 수정 실패");
      setJob(payload.job); setMessage("배경과 상품은 유지하고 문구만 다시 렌더링했습니다.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setCreating(false); }
  }

  return (
    <main className={styles.main}>
      <header className={styles.hero}><p>CATEGORY CREATIVE STUDIO</p><h1>카테고리 대표 이미지 제작</h1><span>기존 상품 광고 6장 제작과 분리된 기능입니다. 한 콘셉트로 정사각형과 세로형을 함께 만듭니다.</span></header>
      <section className={styles.setup}>
        <div className={styles.step}><b>1</b><div><h2>광고주와 카테고리</h2><p>서로 다른 업체의 상품은 섞지 않습니다.</p></div></div>
        <div className={styles.fields}>
          <label><span>광고주</span><select value={advertiserId} onChange={(event) => changeAdvertiser(event.target.value)}><option value="">광고주 선택</option>{advertisers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>카테고리</span><select value={categoryId} onChange={(event) => changeCategory(event.target.value)}>{defaultFashionCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
      </section>
      <section className={styles.setup}>
        <div className={styles.step}><b>2</b><div><h2>상품 자동 선정</h2><p>선택한 업체의 같은 카테고리 안에서 제작에 사용할 실제 상품과 대표 이미지를 자동으로 준비합니다.</p></div></div>
        <div className={`${styles.autoStatus} ${autoLoading ? styles.loading : selectedSources.length >= 3 ? styles.ready : styles.needsHelp}`}>
          <div>
            <strong>{autoLoading ? "상품 후보와 이미지를 가져오는 중입니다" : selectedSources.length >= 3 ? `${selectedSources.length}개 상품이 준비되었습니다` : "자동으로 준비된 상품이 부족합니다"}</strong>
            <span>{autoLoading ? "등록된 광고 후보를 먼저 확인하고, 필요할 때만 쇼핑몰을 탐색합니다." : autoImportedCount > 0 ? `이번에 ${autoImportedCount}개 상품을 새로 가져왔습니다.` : selectedSources.length >= 3 ? "기존에 준비된 실제 상품을 재사용합니다." : "아래 직접 변경 옵션에서 이미지를 추가할 수 있습니다."}</span>
          </div>
          {!autoLoading && selectedSources.length < 3 ? <button disabled={!advertiserId} onClick={() => setAutoReloadKey((current) => current + 1)} type="button">자동 준비 다시 시도</button> : null}
        </div>
        {autoWarnings.length ? <details className={styles.warning}><summary>자동 준비 안내 {autoWarnings.length}건</summary>{autoWarnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</details> : null}
        {selectedSources.length ? <div className={`${styles.sourceGrid} ${styles.autoGrid}`}>{selectedSources.map((source, index) => <article className={styles.selected} key={source.id}><div className={styles.imageFrame}><img alt={source.productName} src={`/api/category-creatives/sources/${source.id}/image`} /><span>{index + 1}</span></div><strong title={source.productName}>{source.productName}</strong><small>{source.imageSource === "product-page" ? "상세페이지 자동 수집" : source.sourceType === "automatic" ? "후보 이미지 자동 수집" : "등록 상품"}</small>{source.productUrl ? <a href={source.productUrl} rel="noreferrer" target="_blank">상품 페이지 확인</a> : null}</article>)}</div> : !autoLoading ? <div className={styles.empty}>선택한 카테고리에서 실제 상품 이미지를 찾지 못했습니다.</div> : null}
        <details className={styles.advanced}>
          <summary>상품 직접 바꾸기·이미지 업로드 <span>선택 사항</span></summary>
          <div className={styles.advancedBody}>
            <p>자동 선정 결과를 바꾸고 싶을 때만 사용하세요. 3–5장을 선택하고 대표 상품과 순서를 정할 수 있습니다.</p>
            <div className={styles.upload}><input placeholder="상품명(선택)" value={productName} onChange={(event) => setProductName(event.target.value)} /><label className={!advertiserId ? styles.disabled : ""}>{uploading ? "업로드 중…" : "원본 이미지 추가"}<input accept="image/jpeg,image/png,image/webp" disabled={!advertiserId || uploading} multiple onChange={upload} type="file" /></label></div>
            {sources.length ? <div className={styles.sourceGrid}>{sources.map((source) => { const selectedIndex = selectedIds.indexOf(source.id); return <article className={selectedIndex >= 0 ? styles.selected : ""} key={source.id}><button onClick={() => toggleSource(source.id)} type="button"><img alt={source.productName} src={`/api/category-creatives/sources/${source.id}/image`} /><span>{selectedIndex >= 0 ? `${selectedIndex + 1}번째 선택` : "선택"}</span></button><strong>{source.productName}</strong>{selectedIndex >= 0 ? <div><button onClick={() => move(source.id, -1)} type="button">←</button><label><input checked={representativeId === source.id} name="representative" onChange={() => setRepresentativeId(source.id)} type="radio" /> 대표</label><button onClick={() => move(source.id, 1)} type="button">→</button></div> : null}</article>; })}</div> : <div className={styles.empty}>추가로 선택할 수 있는 상품 이미지가 없습니다.</div>}
          </div>
        </details>
      </section>
      <section className={styles.setup}>
        <div className={styles.step}><b>3</b><div><h2>카테고리 이미지 제작</h2><p>준비된 상품으로 정사각형과 세로형을 한 번에 만듭니다.</p></div></div>
        <button className={styles.create} disabled={!advertiserId || selectedIds.length < 3 || autoLoading || creating} onClick={create} type="button">{creating ? "두 규격 제작 중…" : autoLoading ? "상품 준비 중…" : `${categoryName} 대표 이미지 제작하기`}</button>
        <details className={styles.copyAdvanced}>
          <summary>문구·스타일 세부 설정 <span>선택 사항</span></summary>
          <div className={styles.copyAdvancedBody}>
            <label><span>스타일</span><select value={style} onChange={(event) => setStyle(event.target.value as CategoryCreativeStyle)}>{styleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <div className={styles.copyFields}><label><span>메인 문구</span><input value={copy.headline} onChange={(event) => setCopy({ ...copy, headline: event.target.value })} /></label><label><span>보조 문구</span><input value={copy.subheadline} onChange={(event) => setCopy({ ...copy, subheadline: event.target.value })} /></label><label><span>CTA</span><input value={copy.cta} onChange={(event) => setCopy({ ...copy, cta: event.target.value })} /></label></div>
            <p>가격·할인·성과 수치는 근거 없이 자동으로 만들지 않습니다.</p>
          </div>
        </details>
        {message ? <p className={styles.message}>{message}</p> : null}
      </section>
      {job?.outputs ? <section className={styles.results}>
        <div className={styles.resultHeader}><div><p>ONE CONCEPT · TWO RATIOS</p><h2>{job.categoryName} 대표 이미지 완성</h2><span>{job.conceptSummary}</span></div><div className={styles.downloads}><a href={`/api/category-creatives/jobs/${job.id}/asset/square`} download>1:1 받기</a><a href={`/api/category-creatives/jobs/${job.id}/asset/vertical`} download>9:16 받기</a><a href={`/api/category-creatives/jobs/${job.id}/download`}>전체 ZIP</a></div></div>
        <div className={styles.previewGrid}><figure><img alt={`${job.categoryName} 정사각형`} src={`/api/category-creatives/jobs/${job.id}/asset/square?v=${encodeURIComponent(job.updatedAt)}`} /><figcaption>정사각형 · 1200×1200</figcaption></figure><figure className={styles.vertical}><img alt={`${job.categoryName} 세로형`} src={`/api/category-creatives/jobs/${job.id}/asset/vertical?v=${encodeURIComponent(job.updatedAt)}`} /><figcaption>세로형 · 1080×1920</figcaption></figure></div>
        <div className={styles.resultActions}><button className={styles.rerender} disabled={creating} onClick={rerenderCopy} type="button">상품·배경 유지하고 문구만 다시 적용</button><button className={styles.regenerate} disabled={creating} onClick={create} type="button">같은 원본으로 새 콘셉트 작업 만들기</button></div>
      </section> : null}
    </main>
  );
}

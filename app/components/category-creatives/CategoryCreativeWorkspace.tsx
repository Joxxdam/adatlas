"use client";

import { useEffect, useMemo, useState } from "react";
import type { BigQueryAdvertiser } from "../../lib/bigquery/types";
import { defaultFashionCategories } from "../../lib/category-candidates/normalization";
import type { CategoryCreativeCopy, CategoryCreativeJob, CategoryCreativeSource, CategoryCreativeStyle } from "../../lib/category-creatives/types";
import styles from "./CategoryCreativeWorkspace.module.css";

type Props = { initialAdvertiserId?: string; initialAdvertiserName?: string; initialCategoryId?: string; initialCategoryName?: string };

const styleOptions: Array<{ value: CategoryCreativeStyle; label: string }> = [
  { value: "auto", label: "자동 추천" }, { value: "editorial", label: "에디토리얼" }, { value: "practical", label: "실용 코디" }, { value: "seasonal", label: "시즌 무드" }, { value: "friendly", label: "친근한 SNS" },
];

export function CategoryCreativeWorkspace(props: Props) {
  const [advertisers, setAdvertisers] = useState<BigQueryAdvertiser[]>([]);
  const [advertiserId, setAdvertiserId] = useState(props.initialAdvertiserId || "");
  const [advertiserName, setAdvertiserName] = useState(props.initialAdvertiserName || "");
  const [categoryId, setCategoryId] = useState(props.initialCategoryId || defaultFashionCategories[0].id);
  const [categoryName, setCategoryName] = useState(props.initialCategoryName || defaultFashionCategories[0].name);
  const [style, setStyle] = useState<CategoryCreativeStyle>("auto");
  const [sources, setSources] = useState<CategoryCreativeSource[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [representativeId, setRepresentativeId] = useState("");
  const [productName, setProductName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<CategoryCreativeJob | null>(null);
  const [copy, setCopy] = useState<CategoryCreativeCopy>({ headline: `요즘 ${categoryName}, 이렇게 입어요`, subheadline: "서로 다른 무드를 한 장에서 비교해보세요", cta: "스타일 모아보기" });
  const [message, setMessage] = useState("");

  const selectedAdvertiser = useMemo(() => advertisers.find((item) => item.id === advertiserId), [advertiserId, advertisers]);

  useEffect(() => {
    fetch("/api/ad-candidates/brands").then((response) => response.json()).then((payload) => {
      if (payload.ok) setAdvertisers(payload.advertisers || payload.rows || []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!advertiserId || !categoryId) { setSources([]); return; }
    fetch(`/api/category-creatives/sources?advertiserId=${encodeURIComponent(advertiserId)}&categoryId=${encodeURIComponent(categoryId)}`).then((response) => response.json()).then((payload) => {
      if (payload.ok) setSources(payload.sources || []);
    }).catch(() => setMessage("등록된 원본 이미지를 불러오지 못했습니다."));
  }, [advertiserId, categoryId]);

  function changeAdvertiser(nextId: string) {
    const match = advertisers.find((item) => item.id === nextId);
    setAdvertiserId(nextId); setAdvertiserName(match?.name || ""); setSelectedIds([]); setRepresentativeId(""); setJob(null); setMessage("");
    setCopy({ headline: `요즘 ${categoryName}, 이렇게 입어요`, subheadline: "서로 다른 무드를 한 장에서 비교해보세요", cta: "스타일 모아보기" });
  }

  function changeCategory(nextId: string) {
    const match = defaultFashionCategories.find((item) => item.id === nextId);
    const name = match?.name || "미분류";
    setCategoryId(nextId); setCategoryName(name); setSelectedIds([]); setRepresentativeId(""); setJob(null); setMessage("");
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
        form.set("file", file); form.set("advertiserId", advertiserId); form.set("advertiserName", advertiserName || selectedAdvertiser?.name || ""); form.set("categoryId", categoryId); form.set("categoryName", categoryName); form.set("productName", productName || file.name.replace(/\.[^.]+$/, ""));
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
      const response = await fetch("/api/category-creatives/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ advertiserId, advertiserName: advertiserName || selectedAdvertiser?.name, categoryId, categoryName, style, sourceIds: selectedIds, representativeSourceId: representativeId, copy }) });
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
          <label><span>스타일</span><select value={style} onChange={(event) => setStyle(event.target.value as CategoryCreativeStyle)}>{styleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </section>
      <section className={styles.setup}>
        <div className={styles.step}><b>2</b><div><h2>실제 상품 이미지 3–5장</h2><p>상품 형태·색상·디테일을 보존합니다. 아래 패션 예시는 구도 참고일 뿐 상품 원본으로 사용하지 않습니다.</p></div></div>
        <div className={styles.upload}><input placeholder="상품명(선택)" value={productName} onChange={(event) => setProductName(event.target.value)} /><label className={!advertiserId ? styles.disabled : ""}>{uploading ? "업로드 중…" : "원본 이미지 추가"}<input accept="image/jpeg,image/png,image/webp" disabled={!advertiserId || uploading} multiple onChange={upload} type="file" /></label></div>
        {sources.length ? <div className={styles.sourceGrid}>{sources.map((source) => { const selectedIndex = selectedIds.indexOf(source.id); return <article className={selectedIndex >= 0 ? styles.selected : ""} key={source.id}><button onClick={() => toggleSource(source.id)} type="button"><img alt={source.productName} src={`/api/category-creatives/sources/${source.id}/image`} /><span>{selectedIndex >= 0 ? `${selectedIndex + 1}번째 선택` : "선택"}</span></button><strong>{source.productName}</strong>{selectedIndex >= 0 ? <div><button onClick={() => move(source.id, -1)} type="button">←</button><label><input checked={representativeId === source.id} name="representative" onChange={() => setRepresentativeId(source.id)} type="radio" /> 대표</label><button onClick={() => move(source.id, 1)} type="button">→</button></div> : null}</article>; })}</div> : <div className={styles.empty}>선택한 광고주·카테고리에 등록된 실제 상품 이미지가 없습니다. 먼저 3장 이상 업로드해 주세요.</div>}
      </section>
      <section className={styles.setup}>
        <div className={styles.step}><b>3</b><div><h2>한 번만 쓰는 카테고리 문구</h2><p>가격·할인·성과 수치는 자동으로 만들지 않습니다.</p></div></div>
        <div className={styles.copyFields}><label><span>메인 문구</span><input value={copy.headline} onChange={(event) => setCopy({ ...copy, headline: event.target.value })} /></label><label><span>보조 문구</span><input value={copy.subheadline} onChange={(event) => setCopy({ ...copy, subheadline: event.target.value })} /></label><label><span>CTA</span><input value={copy.cta} onChange={(event) => setCopy({ ...copy, cta: event.target.value })} /></label></div>
        <button className={styles.create} disabled={!advertiserId || selectedIds.length < 3 || creating} onClick={create} type="button">{creating ? "두 규격 제작 중…" : `선택한 ${selectedIds.length}장으로 카테고리 이미지 만들기`}</button>
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

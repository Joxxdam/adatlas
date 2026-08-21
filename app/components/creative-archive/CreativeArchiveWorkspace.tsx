"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CreativeArchiveEntry, CreativeArchiveResponse } from "../../lib/creative-archive/types";
import styles from "./CreativeArchiveWorkspace.module.css";

const statusLabels: Record<string, string> = {
  draft: "초안",
  generated: "생성 완료",
  exported: "다운로드됨",
  running: "집행 중",
  performance_linked: "성과 연결됨",
  learning_completed: "학습 완료",
  success: "검수 통과",
  approved: "승인됨",
  "korean-review": "문구 확인 필요",
  "product-review": "상품 확인 필요",
  "quality-review": "품질 확인 필요",
  "group-review": "세트 확인 필요",
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right, "ko"));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function downloadFileName(entry: CreativeArchiveEntry) {
  return entry.fileName || `${entry.productName}-${entry.hookCode}.jpg`;
}

function ArchiveCard({
  entry,
  onUpdate,
  onNotice,
}: {
  entry: CreativeArchiveEntry;
  onUpdate: (entry: CreativeArchiveEntry) => void;
  onNotice: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(entry.note);
  const [tags, setTags] = useState(entry.tags.join(", "));

  async function patch(changes: { savedAsReference?: boolean; tags?: string[]; note?: string }) {
    setBusy(true);
    try {
      const response = await fetch(`/api/creative-archive/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = (await response.json()) as { entry?: CreativeArchiveEntry; error?: string };
      if (!response.ok || !payload.entry) throw new Error(payload.error || "저장에 실패했습니다.");
      onUpdate(payload.entry);
      setNote(payload.entry.note);
      setTags(payload.entry.tags.join(", "));
      onNotice(payload.entry.savedAsReference ? "업체 레퍼런스로 보관했습니다." : "레퍼런스 표시를 해제했습니다.");
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "아카이브 정보를 저장하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      const response = await fetch(entry.downloadUrl || entry.imageUrl);
      if (!response.ok) throw new Error("이미지 파일을 불러오지 못했습니다.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFileName(entry);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      onNotice("이미지 콘텐츠를 다운로드했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "다운로드에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`${styles.card}${entry.savedAsReference ? ` ${styles.referenceCard}` : ""}`}>
      <div className={styles.media}>
        {/* Runtime-generated local files intentionally bypass Next image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`${entry.productName} ${entry.hookCode} 광고 콘텐츠`} loading="lazy" src={entry.imageUrl} />
        <div className={styles.mediaBadges}>
          <span>{entry.hookCode || "후킹"}</span>
          {entry.qaScore !== undefined ? <span>QA {entry.qaScore}</span> : null}
        </div>
        <button
          aria-label={entry.savedAsReference ? "업체 레퍼런스 해제" : "업체 레퍼런스로 저장"}
          className={entry.savedAsReference ? styles.referenceActive : ""}
          disabled={busy}
          onClick={() => void patch({ savedAsReference: !entry.savedAsReference })}
          type="button"
        >
          {entry.savedAsReference ? "★ 레퍼런스" : "☆ 레퍼런스 저장"}
        </button>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHeading}>
          <div>
            <p>{entry.hookType || "후킹 유형 미기록"}</p>
            <h3>{entry.headline}</h3>
          </div>
          <span className={styles.status}>{statusLabels[entry.status] || entry.status}</span>
        </div>
        {entry.subCopy ? <p className={styles.subCopy}>{entry.subCopy}</p> : null}
        <dl className={styles.meta}>
          <div><dt>생성일</dt><dd>{dateLabel(entry.createdAt)}</dd></div>
          {entry.assetCode ? <div><dt>소재코드</dt><dd><code>{entry.assetCode}</code></dd></div> : null}
        </dl>
        {entry.tags.length ? (
          <div className={styles.tags}>{entry.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
        ) : null}
        {entry.note ? <p className={styles.note}>{entry.note}</p> : null}
        <div className={styles.actions}>
          <button disabled={busy} onClick={() => void download()} type="button">다운로드</button>
          {entry.resultUrl ? <Link href={entry.resultUrl}>제작 결과 열기</Link> : null}
          <button onClick={() => setEditing((current) => !current)} type="button">태그·메모</button>
        </div>
        {editing ? (
          <div className={styles.editor}>
            <label>
              <span>분류 태그</span>
              <input
                maxLength={240}
                onChange={(event) => setTags(event.target.value)}
                placeholder="예: 여름, 쿨링, 미팅 우선안"
                value={tags}
              />
            </label>
            <label>
              <span>레퍼런스 메모</span>
              <textarea
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="성과나 재사용할 포인트를 기록하세요."
                value={note}
              />
            </label>
            <button
              disabled={busy}
              onClick={() => void patch({
                tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                note,
              }).then((saved) => { if (saved) setEditing(false); })}
              type="button"
            >
              {busy ? "저장 중…" : "메모 저장"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function CreativeArchiveWorkspace({ initialEntries }: { initialEntries: CreativeArchiveEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  const [advertiser, setAdvertiser] = useState("");
  const [product, setProduct] = useState("");
  const [hook, setHook] = useState("");
  const [referencesOnly, setReferencesOnly] = useState(false);
  const [notice, setNotice] = useState("생성 결과를 복제하지 않고 원본 작업과 소재코드에 연결해 보관합니다.");
  const [refreshing, setRefreshing] = useState(false);

  const advertisers = useMemo(() => unique(entries.map((entry) => entry.advertiserName)), [entries]);
  const products = useMemo(
    () => unique(entries.filter((entry) => !advertiser || entry.advertiserName === advertiser).map((entry) => entry.productName)),
    [advertiser, entries]
  );
  const hooks = useMemo(() => unique(entries.map((entry) => entry.hookCode)), [entries]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const haystack = [
        entry.advertiserName,
        entry.brandName,
        entry.productName,
        entry.assetCode,
        entry.hookCode,
        entry.hookType,
        entry.headline,
        entry.subCopy,
        entry.note,
        ...entry.tags,
      ].join(" ").toLowerCase();
      return (
        (!normalizedQuery || haystack.includes(normalizedQuery)) &&
        (!advertiser || entry.advertiserName === advertiser) &&
        (!product || entry.productName === product) &&
        (!hook || entry.hookCode === hook) &&
        (!referencesOnly || entry.savedAsReference)
      );
    });
  }, [advertiser, entries, hook, product, query, referencesOnly]);
  const groups = useMemo(() => {
    const grouped = new Map<string, { advertiserName: string; productName: string; entries: CreativeArchiveEntry[] }>();
    for (const entry of visible) {
      const key = `${entry.advertiserName}\u0000${entry.productName}`;
      const current = grouped.get(key) || { advertiserName: entry.advertiserName, productName: entry.productName, entries: [] };
      current.entries.push(entry);
      grouped.set(key, current);
    }
    return Array.from(grouped.values());
  }, [visible]);
  const stats = useMemo(() => ({
    total: entries.length,
    references: entries.filter((entry) => entry.savedAsReference).length,
    advertisers: unique(entries.map((entry) => entry.advertiserName)).length,
    products: unique(entries.map((entry) => `${entry.advertiserName}:${entry.productName}`)).length,
  }), [entries]);

  function updateEntry(next: CreativeArchiveEntry) {
    setEntries((current) => current.map((entry) => entry.id === next.id ? next : entry));
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/creative-archive", { cache: "no-store" });
      const payload = (await response.json()) as Partial<CreativeArchiveResponse> & { error?: string };
      if (!response.ok || !payload.entries) throw new Error(payload.error || "아카이브를 새로고침하지 못했습니다.");
      setEntries(payload.entries);
      setNotice(`최신 이미지 콘텐츠 ${payload.entries.length}개를 반영했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "아카이브를 새로고침하지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">CREATIVE ARCHIVE</p>
          <h1>이미지 콘텐츠 아카이브</h1>
          <p>완성한 광고 이미지를 업체와 상품별로 모아보고, 다시 쓸 레퍼런스에는 태그와 메모를 남깁니다.</p>
        </div>
        <button disabled={refreshing} onClick={() => void refresh()} type="button">
          {refreshing ? "새로고침 중…" : "최신 결과 불러오기"}
        </button>
      </header>

      <section className={styles.stats} aria-label="아카이브 요약">
        <article><span>전체 콘텐츠</span><strong>{stats.total}</strong></article>
        <article><span>업체 레퍼런스</span><strong>{stats.references}</strong></article>
        <article><span>광고주</span><strong>{stats.advertisers}</strong></article>
        <article><span>상품</span><strong>{stats.products}</strong></article>
      </section>

      <p aria-live="polite" className={styles.notice}>{notice}</p>

      <section className={styles.filters} aria-label="아카이브 검색과 필터">
        <label className={styles.search}>
          <span>검색</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="업체·상품·후킹·문구·소재코드 검색"
            value={query}
          />
        </label>
        <label>
          <span>광고주</span>
          <select onChange={(event) => { setAdvertiser(event.target.value); setProduct(""); }} value={advertiser}>
            <option value="">전체 광고주</option>
            {advertisers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>상품</span>
          <select onChange={(event) => setProduct(event.target.value)} value={product}>
            <option value="">전체 상품</option>
            {products.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>후킹</span>
          <select onChange={(event) => setHook(event.target.value)} value={hook}>
            <option value="">전체 후킹</option>
            {hooks.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={styles.referenceToggle}>
          <input checked={referencesOnly} onChange={(event) => setReferencesOnly(event.target.checked)} type="checkbox" />
          <span>업체 레퍼런스만</span>
        </label>
      </section>

      <div className={styles.resultSummary}>
        <strong>{visible.length}개 콘텐츠</strong>
        <span>{groups.length}개 업체·상품 묶음</span>
      </div>

      {groups.length ? (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section className={styles.group} key={`${group.advertiserName}:${group.productName}`}>
              <header>
                <div><span>{group.advertiserName}</span><h2>{group.productName}</h2></div>
                <b>{group.entries.length}장</b>
              </header>
              <div className={styles.grid}>
                {group.entries.map((entry) => (
                  <ArchiveCard entry={entry} key={entry.id} onNotice={setNotice} onUpdate={updateEntry} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className={styles.empty}>
          <h2>조건에 맞는 이미지 콘텐츠가 없습니다.</h2>
          <p>필터를 초기화하거나 광고 제작에서 새 콘텐츠를 완성해 주세요.</p>
          <Link href="/create-product?step=product">광고 제작으로 이동</Link>
        </section>
      )}
    </main>
  );
}

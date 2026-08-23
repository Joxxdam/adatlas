"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CreativeArchiveEntry, CreativeArchiveResponse } from "../../lib/creative-archive/types";
import { AI_GENERATED_IMAGE_DISCLOSURE, advertiserLogos, findAdvertiserLogo } from "../../lib/creative-generation/deliveryBranding";
import { isArchivePerformanceEligible, prepareArchivePerformanceSelection } from "../../lib/meta/archivePerformanceSelection";
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

function normalizedLabel(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^가-힣a-z0-9]+/g, "");
}

function matchingAdvertiserLogoId(advertiserName: string) {
  const target = normalizedLabel(advertiserName);
  if (!target) return "";
  return (
    advertiserLogos.find((logo) => {
      const label = normalizedLabel(logo.label);
      return label === target || label.includes(target) || target.includes(label);
    })?.id || ""
  );
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

function displayMaterialCode(entry: CreativeArchiveEntry) {
  return entry.materialCode || (entry.copyPlanMode === "reference-adapted" ? `M${entry.hookCode.replace(/^H/i, "").padStart(2, "0")}` : entry.hookCode);
}

function ArchiveCard({ entry, selected, deletionSelected, brandingSelected, onSelect, onToggleDeletion, onToggleBranding, onDelete, onUpdate, onNotice }: { entry: CreativeArchiveEntry; selected: boolean; deletionSelected: boolean; brandingSelected: boolean; onSelect: (entry: CreativeArchiveEntry) => void; onToggleDeletion: (entry: CreativeArchiveEntry) => void; onToggleBranding: (entry: CreativeArchiveEntry) => void; onDelete: (entry: CreativeArchiveEntry) => void; onUpdate: (entry: CreativeArchiveEntry) => void; onNotice: (message: string) => void }) {
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
    <article className={`${styles.card}${entry.savedAsReference ? ` ${styles.referenceCard}` : ""}${selected ? ` ${styles.selectedCard}` : ""}${deletionSelected ? ` ${styles.deletionSelectedCard}` : ""}${brandingSelected ? ` ${styles.brandingSelectedCard}` : ""}`}>
      <div className={styles.media}>
        {/* Runtime-generated local files intentionally bypass Next image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`${entry.productName} ${displayMaterialCode(entry)} 광고 콘텐츠`} loading="lazy" src={entry.imageUrl} />
        <div className={styles.mediaBadges}>
          <span>{entry.copyPlanMode === "reference-adapted" ? `소재 ${displayMaterialCode(entry).replace(/^M/i, "")}` : entry.hookCode || "과거 후킹"}</span>
          {entry.qaScore !== undefined ? <span>QA {entry.qaScore}</span> : null}
          {entry.deliveryBranding?.logoId ? <span>로고 적용</span> : null}
          {entry.deliveryBranding?.aiDisclosure ? <span>AI 고지</span> : null}
        </div>
        {brandingSelected ? <span className={styles.brandingSelectionBadge}>✓ 로고·AI 적용 대상</span> : null}
        <button aria-label={entry.savedAsReference ? "업체 레퍼런스 해제" : "업체 레퍼런스로 저장"} className={entry.savedAsReference ? styles.referenceActive : ""} disabled={busy} onClick={() => void patch({ savedAsReference: !entry.savedAsReference })} type="button">
          {entry.savedAsReference ? "★ 레퍼런스" : "☆ 레퍼런스 저장"}
        </button>
        <button aria-pressed={selected} className={`${styles.performanceSelect}${selected ? ` ${styles.performanceSelected}` : ""}`} disabled={!isArchivePerformanceEligible(entry)} onClick={() => onSelect(entry)} title={isArchivePerformanceEligible(entry) ? "성과 테스트에 사용할 소재 선택" : "성과 연결용 소재코드와 결과 순번이 필요합니다"} type="button">
          {selected ? "✓ 테스트 선택됨" : "+ 성과 테스트"}
        </button>
        <label className={styles.deletionSelect}>
          <input checked={deletionSelected} onChange={() => onToggleDeletion(entry)} type="checkbox" />
          <span>{deletionSelected ? "삭제 선택됨" : "삭제 선택"}</span>
        </label>
      </div>
      <div className={styles.cardBody}>
        <label className={`${styles.brandingSelect}${brandingSelected ? ` ${styles.brandingSelected}` : ""}`}>
          <input checked={brandingSelected} disabled={!entry.brandingEligible} onChange={() => onToggleBranding(entry)} type="checkbox" />
          <span>{entry.brandingEligible ? (brandingSelected ? "로고·AI 고지 적용 선택됨" : "로고·AI 고지 적용 선택") : "이전 소재 · 후처리 미지원"}</span>
        </label>
        <div className={styles.cardHeading}>
          <div>
            <p>{entry.copyPlanMode === "reference-adapted" ? "레퍼런스 기반 완성 소재" : entry.hookType || "후킹 유형 미기록"}</p>
            <h3>{entry.headline}</h3>
          </div>
          <span className={styles.status}>{statusLabels[entry.status] || entry.status}</span>
        </div>
        {entry.subCopy ? <p className={styles.subCopy}>{entry.subCopy}</p> : null}
        <dl className={styles.meta}>
          <div>
            <dt>생성일</dt>
            <dd>{dateLabel(entry.createdAt)}</dd>
          </div>
          {entry.assetCode ? (
            <div>
              <dt>소재코드</dt>
              <dd>
                <code>{entry.assetCode}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        {entry.tags.length ? (
          <div className={styles.tags}>
            {entry.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
        {entry.note ? <p className={styles.note}>{entry.note}</p> : null}
        <div className={styles.actions}>
          <button disabled={busy} onClick={() => void download()} type="button">
            다운로드
          </button>
          {entry.resultUrl ? <Link href={entry.resultUrl}>제작 결과 열기</Link> : null}
          <button onClick={() => setEditing((current) => !current)} type="button">
            태그·메모
          </button>
          <button className={styles.deleteButton} disabled={busy} onClick={() => onDelete(entry)} type="button">
            개별 삭제
          </button>
        </div>
        {editing ? (
          <div className={styles.editor}>
            <label>
              <span>분류 태그</span>
              <input maxLength={240} onChange={(event) => setTags(event.target.value)} placeholder="예: 여름, 쿨링, 미팅 우선안" value={tags} />
            </label>
            <label>
              <span>레퍼런스 메모</span>
              <textarea maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="성과나 재사용할 포인트를 기록하세요." value={note} />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void patch({
                  tags: tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                  note,
                }).then((saved) => {
                  if (saved) setEditing(false);
                })
              }
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletionIds, setDeletionIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [brandingIds, setBrandingIds] = useState<string[]>([]);
  const [brandingAdvertiser, setBrandingAdvertiser] = useState("");
  const [brandingProduct, setBrandingProduct] = useState("");
  const [selectedDeliveryLogoId, setSelectedDeliveryLogoId] = useState("");
  const [logoQuery, setLogoQuery] = useState("");
  const [includeAiDisclosure, setIncludeAiDisclosure] = useState(false);
  const [brandingApplying, setBrandingApplying] = useState(false);

  const advertisers = useMemo(() => unique(entries.map((entry) => entry.advertiserName)), [entries]);
  const products = useMemo(() => unique(entries.filter((entry) => !advertiser || entry.advertiserName === advertiser).map((entry) => entry.productName)), [advertiser, entries]);
  const hooks = useMemo(() => unique(entries.map((entry) => entry.hookCode)), [entries]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const haystack = [entry.advertiserName, entry.brandName, entry.productName, entry.assetCode, entry.hookCode, entry.hookType, entry.headline, entry.subCopy, entry.note, ...entry.tags].join(" ").toLowerCase();
      return (!normalizedQuery || haystack.includes(normalizedQuery)) && (!advertiser || entry.advertiserName === advertiser) && (!product || entry.productName === product) && (!hook || entry.hookCode === hook) && (!referencesOnly || entry.savedAsReference);
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
  const stats = useMemo(
    () => ({
      total: entries.length,
      references: entries.filter((entry) => entry.savedAsReference).length,
      advertisers: unique(entries.map((entry) => entry.advertiserName)).length,
      products: unique(entries.map((entry) => `${entry.advertiserName}:${entry.productName}`)).length,
    }),
    [entries]
  );
  const selectedEntries = useMemo(() => selectedIds.map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is CreativeArchiveEntry => Boolean(entry)), [entries, selectedIds]);
  const performanceSelection = useMemo(() => prepareArchivePerformanceSelection(selectedEntries), [selectedEntries]);
  const selectedDeliveryLogo = findAdvertiserLogo(selectedDeliveryLogoId);
  const brandingProducts = useMemo(() => unique(entries.filter((entry) => !brandingAdvertiser || entry.advertiserName === brandingAdvertiser).map((entry) => entry.productName)), [brandingAdvertiser, entries]);
  const brandingAdvertiserEntries = useMemo(() => entries.filter((entry) => entry.brandingEligible && entry.advertiserName === brandingAdvertiser), [brandingAdvertiser, entries]);
  const brandingProductEntries = useMemo(() => brandingAdvertiserEntries.filter((entry) => entry.productName === brandingProduct), [brandingAdvertiserEntries, brandingProduct]);
  const visibleLogos = useMemo(() => {
    const target = normalizedLabel(logoQuery);
    return target ? advertiserLogos.filter((logo) => normalizedLabel(logo.label).includes(target)) : advertiserLogos;
  }, [logoQuery]);
  const brandingSelectedEntries = useMemo(() => brandingIds.map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is CreativeArchiveEntry => Boolean(entry)), [brandingIds, entries]);
  const brandingSelectionStats = useMemo(() => {
    return {
      advertisers: unique(brandingSelectedEntries.map((entry) => entry.advertiserName)).length,
      products: unique(brandingSelectedEntries.map((entry) => `${entry.advertiserName}:${entry.productName}`)).length,
    };
  }, [brandingSelectedEntries]);
  const brandedSelectedCount = useMemo(() => brandingIds.filter((id) => entries.find((entry) => entry.id === id)?.deliveryBranding).length, [brandingIds, entries]);

  function updateEntry(next: CreativeArchiveEntry) {
    setEntries((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
  }

  function toggleDeletionSelection(entry: CreativeArchiveEntry) {
    setDeletionIds((current) => (current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]));
  }

  function toggleBrandingSelection(entry: CreativeArchiveEntry) {
    if (!entry.brandingEligible) {
      setNotice("이전 제작 방식으로 저장된 이 이미지는 원본 연결 정보가 없어 로고·AI 고지 후처리를 지원하지 않습니다.");
      return;
    }
    setBrandingIds((current) => (current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]));
  }

  function toggleBrandingScope(scopeEntries: CreativeArchiveEntry[], label: string) {
    const eligibleIds = scopeEntries.filter((entry) => entry.brandingEligible).map((entry) => entry.id);
    if (!eligibleIds.length) {
      setNotice(`${label}에는 로고·AI 고지를 적용할 수 있는 이미지가 없습니다.`);
      return;
    }
    const allSelected = eligibleIds.every((id) => brandingIds.includes(id));
    setBrandingIds((current) => (allSelected ? current.filter((id) => !eligibleIds.includes(id)) : Array.from(new Set([...current, ...eligibleIds]))));
    setNotice(allSelected ? `${label} 이미지 ${eligibleIds.length}장의 후처리 선택을 해제했습니다.` : `${label} 이미지 ${eligibleIds.length}장만 후처리 대상으로 선택했습니다.`);
  }

  async function applyArchiveBranding(clear = false) {
    if (!brandingIds.length || brandingApplying) return;
    setBrandingApplying(true);
    try {
      const batches = Array.from({ length: Math.ceil(brandingIds.length / 100) }, (_, index) => brandingIds.slice(index * 100, index * 100 + 100));
      let appliedCount = 0;
      let failedCount = 0;
      let nextEntries = entries;
      for (const entryIds of batches) {
        const response = await fetch("/api/creative-archive/delivery-branding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryIds,
            clear,
            logoId: clear ? undefined : selectedDeliveryLogoId || undefined,
            aiDisclosure: clear ? false : includeAiDisclosure,
          }),
        });
        const payload = (await response.json()) as Partial<CreativeArchiveResponse> & {
          appliedCount?: number;
          failedCount?: number;
          error?: string;
        };
        if (!response.ok || !payload.entries || !payload.appliedCount) {
          throw new Error(payload.error || "선택한 이미지 후처리에 실패했습니다.");
        }
        appliedCount += payload.appliedCount;
        failedCount += payload.failedCount || 0;
        nextEntries = payload.entries;
      }
      setEntries(nextEntries);
      setBrandingIds([]);
      setNotice(clear ? `선택한 이미지 ${appliedCount}장을 원본으로 되돌렸습니다.${failedCount ? ` ${failedCount}장은 처리하지 못했습니다.` : ""} 대상 선택을 초기화했습니다.` : `선택한 이미지 ${appliedCount}장에 로고·AI 고지를 적용했습니다.${failedCount ? ` ${failedCount}장은 처리하지 못했습니다.` : ""} 대상 선택을 초기화했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "선택한 이미지 후처리에 실패했습니다.");
    } finally {
      setBrandingApplying(false);
    }
  }

  function toggleGroupDeletionSelection(groupEntries: CreativeArchiveEntry[]) {
    const ids = groupEntries.map((entry) => entry.id);
    const allSelected = ids.every((id) => deletionIds.includes(id));
    setDeletionIds((current) => (allSelected ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids]))));
  }

  async function deleteEntries(entryIds: string[], label: string) {
    const ids = Array.from(new Set(entryIds)).filter((id) => entries.some((entry) => entry.id === id));
    if (!ids.length || deleting) return;
    if (!window.confirm(`${label} ${ids.length}장을 아카이브에서 삭제하시겠습니까?\n원본 제작 작업과 파일은 보존됩니다.`)) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/creative-archive", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: ids }),
      });
      const payload = (await response.json()) as Partial<CreativeArchiveResponse> & { deletedIds?: string[]; error?: string };
      if (!response.ok || !payload.entries || !payload.deletedIds) throw new Error(payload.error || "선택한 이미지를 삭제하지 못했습니다.");
      const removed = new Set(payload.deletedIds);
      setEntries(payload.entries);
      setDeletionIds((current) => current.filter((id) => !removed.has(id)));
      setSelectedIds((current) => current.filter((id) => !removed.has(id)));
      setBrandingIds((current) => current.filter((id) => !removed.has(id)));
      setNotice(`${payload.deletedIds.length}장의 이미지 콘텐츠를 아카이브에서 삭제했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "선택한 이미지를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  function togglePerformanceSelection(entry: CreativeArchiveEntry) {
    if (!isArchivePerformanceEligible(entry)) {
      setNotice("소재코드와 결과 순번이 발급된 완성 이미지만 성과 테스트에 사용할 수 있습니다.");
      return;
    }
    if (selectedIds.includes(entry.id)) {
      setSelectedIds((current) => current.filter((id) => id !== entry.id));
      setNotice(`${entry.copyPlanMode === "reference-adapted" ? `소재 ${entry.hookCode.replace(/^H/i, "")}` : entry.hookCode}를 성과 확인에서 제외했습니다.`);
      return;
    }
    const base = selectedEntries[0];
    const sameAdvertiser = !base || (base.advertiserId || base.advertiserName) === (entry.advertiserId || entry.advertiserName);
    const sameProduct = !base || (base.productId || base.productName) === (entry.productId || entry.productName);
    if (!sameAdvertiser || !sameProduct) {
      setSelectedIds([entry.id]);
      setNotice("다른 상품을 선택해 기존 선택을 비우고 새 성과 테스트 묶음을 시작했습니다.");
      return;
    }
    if (selectedEntries.some((item) => item.hookCode === entry.hookCode)) {
      setNotice(`${entry.copyPlanMode === "reference-adapted" ? `소재 ${entry.hookCode.replace(/^H/i, "")}` : entry.hookCode}은 이미 선택했습니다.`);
      return;
    }
    if (selectedIds.length >= 6) {
      setNotice("한 번에 최대 6장까지 성과 테스트에 사용할 수 있습니다.");
      return;
    }
    setSelectedIds((current) => [...current, entry.id]);
    setNotice(`${entry.copyPlanMode === "reference-adapted" ? `소재 ${entry.hookCode.replace(/^H/i, "")}` : entry.hookCode}를 성과 확인에 추가했습니다.`);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/creative-archive", { cache: "no-store" });
      const payload = (await response.json()) as Partial<CreativeArchiveResponse> & { error?: string };
      if (!response.ok || !payload.entries) throw new Error(payload.error || "아카이브를 새로고침하지 못했습니다.");
      setEntries(payload.entries);
      const availableIds = new Set(payload.entries.map((entry) => entry.id));
      setDeletionIds((current) => current.filter((id) => availableIds.has(id)));
      setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
      setBrandingIds((current) => current.filter((id) => availableIds.has(id)));
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
          <p>완성한 광고 이미지를 업체와 상품별로 보관하고, 같은 상품 소재를 골라 성과 테스트 설정으로 이어갑니다.</p>
        </div>
        <button disabled={refreshing} onClick={() => void refresh()} type="button">
          {refreshing ? "새로고침 중…" : "최신 결과 불러오기"}
        </button>
      </header>

      <section className={styles.stats} aria-label="아카이브 요약">
        <article>
          <span>전체 콘텐츠</span>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <span>업체 레퍼런스</span>
          <strong>{stats.references}</strong>
        </article>
        <article>
          <span>광고주</span>
          <strong>{stats.advertisers}</strong>
        </article>
        <article>
          <span>상품</span>
          <strong>{stats.products}</strong>
        </article>
      </section>

      <p aria-live="polite" className={styles.notice}>
        {notice}
      </p>

      <section className={styles.brandingPanel} aria-label="아카이브 이미지 로고와 AI 생성 고지 적용">
        <div className={styles.brandingIntro}>
          <span>선택 후처리</span>
          <strong>아카이브 이미지에 로고·AI 고지 적용</strong>
          <small>업체·상품·개별 이미지를 먼저 선택하면 로고와 AI 고지 설정이 열립니다. 원본은 보존되며 언제든 되돌릴 수 있습니다.</small>
        </div>

        <div className={styles.brandingTargets}>
          <div className={styles.targetGuide}>
            <strong>1. 적용할 업체·상품 선택</strong>
            <small>업체 전체, 상품 전체 또는 아래 카드의 개별 체크박스 중 원하는 범위만 선택하세요.</small>
          </div>
          <label>
            <span>업체</span>
            <select
              onChange={(event) => {
                const nextAdvertiser = event.target.value;
                setBrandingAdvertiser(nextAdvertiser);
                setBrandingProduct("");
                const matchedLogoId = matchingAdvertiserLogoId(nextAdvertiser);
                if (matchedLogoId) setSelectedDeliveryLogoId(matchedLogoId);
              }}
              value={brandingAdvertiser}
            >
              <option value="">업체를 선택하세요</option>
              {advertisers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!brandingAdvertiser || !brandingAdvertiserEntries.length} onClick={() => toggleBrandingScope(brandingAdvertiserEntries, brandingAdvertiser)} type="button">
            {brandingAdvertiser && brandingAdvertiserEntries.every((entry) => brandingIds.includes(entry.id)) ? `업체 ${brandingAdvertiserEntries.length}장 선택 해제` : `업체 ${brandingAdvertiserEntries.length}장 선택`}
          </button>
          <label>
            <span>상품</span>
            <select disabled={!brandingAdvertiser} onChange={(event) => setBrandingProduct(event.target.value)} value={brandingProduct}>
              <option value="">상품을 선택하세요</option>
              {brandingProducts.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!brandingProduct || !brandingProductEntries.length} onClick={() => toggleBrandingScope(brandingProductEntries, brandingProduct)} type="button">
            {brandingProduct && brandingProductEntries.every((entry) => brandingIds.includes(entry.id)) ? `상품 ${brandingProductEntries.length}장 선택 해제` : `상품 ${brandingProductEntries.length}장 선택`}
          </button>
        </div>

        {brandingIds.length ? (
          <>
            <div className={styles.brandingTargetPreview} aria-label="현재 로고·AI 고지 적용 대상">
              <div className={styles.brandingTargetPreviewHeader}>
                <div>
                  <strong>현재 선택된 이미지 {brandingSelectedEntries.length}장</strong>
                  <small>아래 썸네일과 원본 카드의 파란 테두리로 적용 대상을 확인할 수 있습니다.</small>
                </div>
                <span>썸네일을 누르면 선택 해제</span>
              </div>
              <div className={styles.brandingTargetPreviewGrid}>
                {brandingSelectedEntries.slice(0, 12).map((entry, index) => (
                  <button aria-label={`${entry.productName} ${entry.hookCode} 후처리 선택 해제`} key={entry.id} onClick={() => toggleBrandingSelection(entry)} type="button">
                    <span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src={entry.imageUrl} />
                      <b>{index + 1}</b>
                      <i>선택됨</i>
                    </span>
                    <small>
                      {entry.copyPlanMode === "reference-adapted" ? `소재 ${displayMaterialCode(entry).replace(/^M/i, "")}` : entry.hookCode || "과거 후킹"} · {entry.productName}
                    </small>
                  </button>
                ))}
              </div>
              {brandingSelectedEntries.length > 12 ? <p>외 {brandingSelectedEntries.length - 12}장은 아래 원본 카드의 파란 표시에서 확인할 수 있습니다.</p> : null}
            </div>
            <div className={styles.logoCatalog}>
              <div className={styles.logoCatalogHeader}>
                <div>
                  <strong>2. 우측 상단 업체 로고 선택</strong>
                  <small>선택한 이미지에 적용할 로고를 고르세요.</small>
                </div>
                <label>
                  <span>로고 검색</span>
                  <input onChange={(event) => setLogoQuery(event.target.value)} placeholder="업체명 검색" value={logoQuery} />
                </label>
              </div>
              <div className={styles.logoGrid}>
                <button aria-pressed={!selectedDeliveryLogoId} className={!selectedDeliveryLogoId ? styles.logoTileSelected : ""} onClick={() => setSelectedDeliveryLogoId("")} type="button">
                  <span className={styles.noLogoMark}>로고 없음</span>
                  <strong>적용 안 함</strong>
                </button>
                {visibleLogos.map((logo) => (
                  <button aria-pressed={selectedDeliveryLogoId === logo.id} className={selectedDeliveryLogoId === logo.id ? styles.logoTileSelected : ""} key={logo.id} onClick={() => setSelectedDeliveryLogoId(logo.id)} type="button">
                    <span className={styles.logoTileImage}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={`${logo.label} 로고`} loading="lazy" src={logo.imagePath} />
                    </span>
                    <strong>{logo.label}</strong>
                  </button>
                ))}
              </div>
              {!visibleLogos.length ? <p className={styles.noLogoResult}>검색한 업체 로고가 없습니다.</p> : null}
            </div>

            <div className={styles.brandingOptions}>
              <div className={styles.selectedLogoSummary}>
                <span>선택 로고</span>
                {selectedDeliveryLogo ? (
                  <>
                    <span className={styles.selectedLogoImage}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={`${selectedDeliveryLogo.label} 로고 미리보기`} src={selectedDeliveryLogo.imagePath} />
                    </span>
                    <strong>{selectedDeliveryLogo.label}</strong>
                  </>
                ) : (
                  <strong>적용 안 함</strong>
                )}
              </div>
              <label className={styles.disclosureOption}>
                <input checked={includeAiDisclosure} onChange={(event) => setIncludeAiDisclosure(event.target.checked)} type="checkbox" />
                <span>
                  <strong>AI 생성 이미지 고지 추가</strong>
                  <small>{AI_GENERATED_IMAGE_DISCLOSURE}</small>
                </span>
              </label>
            </div>
          </>
        ) : (
          <div className={styles.brandingPending}>
            <strong>2. 로고·AI 고지 선택</strong>
            <span>적용할 이미지가 선택되면 설정이 표시됩니다.</span>
          </div>
        )}

        <div className={styles.brandingSelectionSummary}>
          <strong>{brandingIds.length}장 선택</strong>
          <span>{brandingIds.length ? `${brandingSelectionStats.advertisers}개 업체 · ${brandingSelectionStats.products}개 상품${brandedSelectedCount ? ` · 현재 ${brandedSelectedCount}장 후처리 적용됨` : ""}` : "업체·상품을 선택하거나 카드에서 이미지 한 장씩 고르세요."}</span>
          <button
            disabled={!brandingIds.length}
            onClick={() => {
              setBrandingIds([]);
              setLogoQuery("");
            }}
            type="button"
          >
            선택 초기화
          </button>
        </div>
        {brandingIds.length ? (
          <div className={styles.brandingActions}>
            <button disabled={brandingApplying || !brandingIds.length || (!selectedDeliveryLogoId && !includeAiDisclosure)} onClick={() => void applyArchiveBranding(false)} type="button">
              {brandingApplying ? "적용 중…" : `선택한 ${brandingIds.length}장에만 적용`}
            </button>
            <button disabled={brandingApplying || !brandingIds.length || !brandedSelectedCount} onClick={() => void applyArchiveBranding(true)} type="button">
              선택 이미지 원본으로
            </button>
          </div>
        ) : null}
      </section>

      <section className={styles.filters} aria-label="아카이브 검색과 필터">
        <label className={styles.search}>
          <span>검색</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="업체·상품·소재 순번·문구·소재코드 검색" value={query} />
        </label>
        <label>
          <span>광고주</span>
          <select
            onChange={(event) => {
              setAdvertiser(event.target.value);
              setProduct("");
            }}
            value={advertiser}
          >
            <option value="">전체 광고주</option>
            {advertisers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>상품</span>
          <select onChange={(event) => setProduct(event.target.value)} value={product}>
            <option value="">전체 상품</option>
            {products.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>소재 순번</span>
          <select onChange={(event) => setHook(event.target.value)} value={hook}>
            <option value="">전체 소재 순번</option>
            {hooks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.referenceToggle}>
          <input checked={referencesOnly} onChange={(event) => setReferencesOnly(event.target.checked)} type="checkbox" />
          <span>업체 레퍼런스만</span>
        </label>
      </section>

      <div className={styles.resultSummary}>
        <div>
          <strong>{visible.length}개 콘텐츠</strong>
          <span>{groups.length}개 업체·상품 묶음</span>
        </div>
        <button
          disabled={!visible.length}
          onClick={() => {
            const visibleIds = visible.map((entry) => entry.id);
            const allSelected = visibleIds.every((id) => deletionIds.includes(id));
            setDeletionIds((current) => (allSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]))));
          }}
          type="button"
        >
          {visible.length > 0 && visible.every((entry) => deletionIds.includes(entry.id)) ? "검색 결과 삭제 선택 해제" : "검색 결과 삭제 전체 선택"}
        </button>
      </div>

      {deletionIds.length ? (
        <section className={styles.deletionTray} aria-label="삭제할 이미지 선택">
          <div>
            <strong>{deletionIds.length}장 삭제 선택</strong>
            <span>상품별 선택 또는 개별 선택한 이미지만 삭제합니다.</span>
          </div>
          <div>
            <button disabled={deleting} onClick={() => setDeletionIds([])} type="button">
              삭제 선택 해제
            </button>
            <button disabled={deleting} onClick={() => void deleteEntries(deletionIds, "선택한 이미지")} type="button">
              {deleting ? "삭제 중…" : "선택한 이미지 모두 삭제"}
            </button>
          </div>
        </section>
      ) : null}

      {selectedEntries.length ? (
        <section className={styles.performanceTray} aria-label="성과 테스트 선택 소재">
          <div>
            <p>PERFORMANCE SETUP</p>
            <strong>
              {selectedEntries[0].productName} · {selectedEntries.length}/6장 선택
            </strong>
            <span>{performanceSelection.message}</span>
          </div>
          <div className={styles.selectedHooks}>
            {performanceSelection.entries.map((entry) => (
              <button key={entry.id} onClick={() => togglePerformanceSelection(entry)} type="button">
                {entry.hookCode} ×
              </button>
            ))}
          </div>
          <div className={styles.performanceTrayActions}>
            <button onClick={() => setSelectedIds([])} type="button">
              선택 초기화
            </button>
            {performanceSelection.valid ? <Link href={`/performance?setup=archive&entryIds=${encodeURIComponent(performanceSelection.entries.map((entry) => entry.id).join(","))}`}>선택 소재로 성과 설정</Link> : <span>2장 이상 선택</span>}
          </div>
        </section>
      ) : null}

      {groups.length ? (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section className={styles.group} key={`${group.advertiserName}:${group.productName}`}>
              <header>
                <div>
                  <span>{group.advertiserName}</span>
                  <h2>{group.productName}</h2>
                </div>
                <div className={styles.groupActions}>
                  <label className={styles.groupBrandingSelect}>
                    <input checked={group.entries.filter((entry) => entry.brandingEligible).length > 0 && group.entries.filter((entry) => entry.brandingEligible).every((entry) => brandingIds.includes(entry.id))} disabled={!group.entries.some((entry) => entry.brandingEligible)} onChange={() => toggleBrandingScope(group.entries, group.productName)} type="checkbox" />
                    <span>로고·AI: 이 상품 전체</span>
                  </label>
                  <label className={styles.groupDeletionSelect}>
                    <input checked={group.entries.every((entry) => deletionIds.includes(entry.id))} onChange={() => toggleGroupDeletionSelection(group.entries)} type="checkbox" />
                    <span>이 상품 전체 선택</span>
                  </label>
                  <button
                    disabled={deleting || !group.entries.some((entry) => deletionIds.includes(entry.id))}
                    onClick={() =>
                      void deleteEntries(
                        group.entries.filter((entry) => deletionIds.includes(entry.id)).map((entry) => entry.id),
                        group.productName
                      )
                    }
                    type="button"
                  >
                    선택 삭제
                  </button>
                  <b>{group.entries.length}장</b>
                </div>
              </header>
              <div className={styles.grid}>
                {group.entries.map((entry) => (
                  <ArchiveCard entry={entry} key={entry.id} brandingSelected={brandingIds.includes(entry.id)} deletionSelected={deletionIds.includes(entry.id)} onDelete={(target) => void deleteEntries([target.id], target.productName)} onNotice={setNotice} onSelect={togglePerformanceSelection} onToggleDeletion={toggleDeletionSelection} onToggleBranding={toggleBrandingSelection} onUpdate={updateEntry} selected={selectedIds.includes(entry.id)} />
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

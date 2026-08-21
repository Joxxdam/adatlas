"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CreativeArchiveEntry } from "../../lib/creative-archive/types";
import {
  archiveEntriesToMetaDrafts,
  prepareArchivePerformanceSelection,
} from "../../lib/meta/archivePerformanceSelection";
import type { PerformanceTestType } from "../../lib/meta/types";
import { MetaDraftRegistrationPanel } from "./MetaDraftRegistrationPanel";
import styles from "./MetaOperations.module.css";

export function ArchivePerformanceSetup({ entries }: { entries: CreativeArchiveEntry[] }) {
  const selection = useMemo(() => prepareArchivePerformanceSelection(entries), [entries]);
  const first = selection.entries[0];
  const [landingUrl, setLandingUrl] = useState(first?.landingUrl || "");
  const [testType, setTestType] = useState<PerformanceTestType>(selection.testType);
  const creatives = useMemo(
    () => archiveEntriesToMetaDrafts(selection.entries, landingUrl.trim()),
    [landingUrl, selection.entries]
  );

  if (!selection.entries.length) {
    return (
      <section className={styles.archiveSetupEmpty}>
        <div>
          <p className="eyebrow">ARCHIVE → PERFORMANCE</p>
          <h2>먼저 아카이브에서 테스트 소재를 선택하세요</h2>
          <p>같은 상품의 완성 이미지 2~6장을 고르면 Meta PAUSED 설정과 성과 비교를 시작할 수 있습니다.</p>
        </div>
        <Link href="/archive">아카이브에서 소재 선택</Link>
      </section>
    );
  }

  return (
    <section className={styles.archiveSetup}>
      <header>
        <div>
          <p className="eyebrow">ARCHIVE → PERFORMANCE</p>
          <h2>{first.productName}</h2>
          <p>{first.advertiserName} · 선택 소재 {selection.entries.length}장</p>
        </div>
        <Link href="/archive">선택 다시 하기</Link>
      </header>

      <div className={styles.archiveCreativeStrip} aria-label="선택한 아카이브 소재">
        {selection.entries.map((entry) => (
          <article key={entry.id}>
            {/* Runtime-generated local files intentionally bypass Next image optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${entry.hookCode} ${entry.headline}`} src={entry.imageUrl} />
            <div><strong>{entry.hookCode}</strong><span>{entry.assetCode}</span></div>
          </article>
        ))}
      </div>

      <div className={styles.testTypeSection}>
        <div>
          <p className="eyebrow">TEST INTERPRETATION</p>
          <h3>이번 성과를 어떤 단위로 해석할까요?</h3>
          <p>{selection.message}</p>
        </div>
        <div className={styles.testTypeChoices}>
          <button
            aria-pressed={testType === "hook-only"}
            className={testType === "hook-only" ? styles.choiceActive : ""}
            disabled={!selection.hookOnlyEligible}
            onClick={() => setTestType("hook-only")}
            type="button"
          >
            <strong>후킹만 비교</strong>
            <span>동일 디자인에서 메인 후킹과 서브 문구만 다른 경우</span>
            {!selection.hookOnlyEligible ? <small>현재 소재는 디자인 조건이 동일하지 않아 선택할 수 없습니다.</small> : null}
          </button>
          <button
            aria-pressed={testType === "creative-combination"}
            className={testType === "creative-combination" ? styles.choiceActive : ""}
            onClick={() => setTestType("creative-combination")}
            type="button"
          >
            <strong>전체 소재 조합 비교</strong>
            <span>후킹·장면·레이아웃이 함께 다른 완성 광고 성과를 비교</span>
            <small>결과를 후킹 단독 효과라고 단정하지 않습니다.</small>
          </button>
        </div>
      </div>

      <label className={styles.landingField}>
        <span>상품 랜딩 URL</span>
        <input
          inputMode="url"
          onChange={(event) => setLandingUrl(event.target.value)}
          placeholder="https://..."
          value={landingUrl}
        />
        <small>아카이브에 저장된 URL을 불러왔습니다. 등록 전 최종 상품 페이지인지 확인하세요.</small>
      </label>

      {!selection.valid ? <p className={styles.warning}>{selection.message}</p> : null}
      {selection.valid && !landingUrl.trim() ? (
        <p className={styles.warning}>상품 랜딩 URL을 입력해야 Meta PAUSED 초안을 설정할 수 있습니다.</p>
      ) : null}
      {selection.valid && landingUrl.trim() ? (
        <MetaDraftRegistrationPanel
          advertiserId={first.advertiserId || first.advertiserName}
          advertiserName={first.advertiserName}
          approvedCreatives={creatives}
          archiveEntryIds={selection.entries.map((entry) => entry.id)}
          landingUrl={landingUrl.trim()}
          productId={first.productId || first.productName}
          productName={first.productName}
          testType={testType}
        />
      ) : null}
    </section>
  );
}

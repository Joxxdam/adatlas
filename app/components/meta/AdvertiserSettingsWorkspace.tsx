"use client";

import Link from "next/link";
import { useState } from "react";
import type { MetaAdvertiserAssetMap } from "../../lib/meta/types";
import styles from "./MetaOperations.module.css";

export function AdvertiserSettingsWorkspace({
  initialMappings,
}: {
  initialMappings: MetaAdvertiserAssetMap[];
}) {
  const [mappings, setMappings] = useState(initialMappings);
  const [draft, setDraft] = useState<MetaAdvertiserAssetMap>({
    advertiserId: "",
    advertiserName: "",
    adAccountIds: [],
  });
  const [message, setMessage] = useState(
    "이 설정은 로컬 자산 허용 범위이며 Meta API를 호출하지 않습니다."
  );

  async function save() {
    const response = await fetch("/api/meta/advertisers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = (await response.json()) as { mapping?: MetaAdvertiserAssetMap; error?: string };
    if (!response.ok || !payload.mapping) {
      setMessage(payload.error || "저장 실패");
      return;
    }
    setMappings((items) => [
      ...items.filter((item) => item.advertiserId !== payload.mapping!.advertiserId),
      payload.mapping!,
    ]);
    setDraft({ advertiserId: "", advertiserName: "", adAccountIds: [] });
    setMessage("광고주와 허용 자산 매핑을 저장했습니다.");
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">MANAGEMENT</p>
          <h1>광고주 설정</h1>
          <p>광고주별 광고 계정·페이지·픽셀 매핑과 자동 제작 설정을 한 곳에서 관리합니다.</p>
        </div>
      </header>
      <p className={styles.notice}>{message}</p>
      <section className={styles.panel}>
        <h2>Meta 자산 매핑</h2>
        <p>
          실제 선택 가능 계정은 시스템 사용자 접근 계정 ∩ 서버 허용 목록 ∩ 아래 광고주 매핑의
          교집합입니다.
        </p>
        <div className={styles.formGrid}>
          <label>
            광고주 ID
            <input
              value={draft.advertiserId}
              onChange={(event) => setDraft({ ...draft, advertiserId: event.target.value })}
            />
          </label>
          <label>
            광고주명
            <input
              value={draft.advertiserName}
              onChange={(event) => setDraft({ ...draft, advertiserName: event.target.value })}
            />
          </label>
          <label>
            허용 광고 계정 ID(쉼표 구분)
            <input
              value={draft.adAccountIds.join(", ")}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  adAccountIds: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            페이지 ID
            <input
              value={draft.pageId || ""}
              onChange={(event) => setDraft({ ...draft, pageId: event.target.value })}
            />
          </label>
          <label>
            Instagram actor ID
            <input
              value={draft.instagramActorId || ""}
              onChange={(event) => setDraft({ ...draft, instagramActorId: event.target.value })}
            />
          </label>
          <label>
            픽셀 ID
            <input
              value={draft.pixelId || ""}
              onChange={(event) => setDraft({ ...draft, pixelId: event.target.value })}
            />
          </label>
          <label>
            데이터셋 ID
            <input
              value={draft.datasetId || ""}
              onChange={(event) => setDraft({ ...draft, datasetId: event.target.value })}
            />
          </label>
          <button
            disabled={!draft.advertiserId.trim() || !draft.advertiserName.trim()}
            onClick={() => void save()}
            type="button"
          >
            매핑 저장
          </button>
        </div>
      </section>
      <section className={styles.list}>
        {mappings.map((mapping) => (
          <article className={styles.card} key={mapping.advertiserId}>
            <header>
              <div>
                <small>{mapping.advertiserId}</small>
                <h2>{mapping.advertiserName}</h2>
                <p>
                  허용 광고 계정 {mapping.adAccountIds.length}개 · 페이지{" "}
                  {mapping.pageId ? "연결" : "미연결"} · 픽셀/데이터셋{" "}
                  {mapping.pixelId || mapping.datasetId ? "연결" : "미연결"}
                </p>
              </div>
            </header>
          </article>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>운영 자동화 설정</h2>
        <p>
          일정·후보·제외 조건과 작업 큐는 자동 제작 관리에서 설정합니다. Meta 게시 자동화는 포함하지
          않습니다.
        </p>
        <Link href="/admin/auto-production">자동 제작 관리 열기</Link>
      </section>
    </main>
  );
}

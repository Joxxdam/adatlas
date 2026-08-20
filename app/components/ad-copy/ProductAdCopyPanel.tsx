"use client";

import { useState } from "react";
import type { ProductAdCopy } from "../../lib/ad-copy/types";
import type { GenerationJob } from "../../lib/creative-generation/types";
import styles from "./ProductAdCopyPanel.module.css";

export function ProductAdCopyPanel({
  jobId,
  adCopy,
  productName,
  onChanged,
}: {
  jobId: string;
  adCopy?: ProductAdCopy;
  productName: string;
  onChanged?: (job: GenerationJob) => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");

  async function action(value: "regenerate" | "approve" | "exclude") {
    setWorking(true);
    setNotice(value === "regenerate" ? "대표 이미지와 후킹을 다시 확인해 문구를 만들고 있어요." : "");
    try {
      const response = await fetch(`/api/creative-generation/jobs/${encodeURIComponent(jobId)}/ad-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: value }),
      });
      const payload = await response.json() as { job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "광고문구 요청을 처리하지 못했습니다.");
      await onChanged?.(payload.job);
      setNotice(value === "regenerate" ? "새 광고문구를 만들었습니다." : value === "approve" ? "광고문구를 승인하고 말투 학습에 저장했습니다." : "광고문구를 제외했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "광고문구 요청을 처리하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function copyText() {
    if (!adCopy?.primaryText) return;
    await navigator.clipboard.writeText(adCopy.primaryText);
    setNotice("Meta 기본 문구를 줄바꿈 그대로 복사했습니다.");
  }

  if (!adCopy) return <section className={styles.panel}><p className={styles.eyebrow}>META 기본 문구 · 상품당 1개</p><strong>대표 이미지의 최종 QA가 끝나면 자동으로 생성됩니다.</strong></section>;
  const visible = Boolean(adCopy.primaryText) && adCopy.status !== "needs-review";
  return (
    <section className={styles.panel} aria-label={`${productName} Meta 기본 문구`}>
      <header>
        <div><p className={styles.eyebrow}>META 기본 문구 · 상품당 1개</p><h5>{visible ? "광고 등록용 문구" : adCopy.status === "generating" ? "광고문구 생성 중" : "문구 확인 필요"}</h5></div>
        <span data-status={adCopy.status}>{adCopy.status === "ready" ? "검수 완료" : adCopy.status === "approved" ? "승인" : adCopy.status === "needs-review" ? "확인 필요" : adCopy.status === "generating" ? "생성 중" : "제외"}</span>
      </header>
      {visible ? <pre>{adCopy.primaryText}</pre> : <p className={styles.help}>{adCopy.status === "needs-review" ? "독립 문구 QA에서 사실성 또는 가독성을 통과하지 못해 문구를 숨겼습니다." : "완성 이미지와 대표 후킹을 분석하고 있습니다."}</p>}
      <dl>
        <div><dt>소재코드</dt><dd>{adCopy.assetCode || "발급 대기"}</dd></div>
        <div><dt>광고명</dt><dd>{adCopy.adName || "발급 대기"}</dd></div>
        <div><dt>UTM</dt><dd>{adCopy.utm || "발급 대기"}</dd></div>
      </dl>
      <div className={styles.actions}>
        <button disabled={!visible || working} onClick={() => void copyText()} type="button">광고문구 복사</button>
        <button disabled={working || adCopy.status === "generating"} onClick={() => void action("regenerate")} type="button">AI로 문구 다시 만들기</button>
        <button disabled={!visible || working || adCopy.status === "approved"} onClick={() => void action("approve")} type="button">문구 승인</button>
        {visible ? <><a href={`/api/creative-generation/jobs/${encodeURIComponent(jobId)}/ad-copy?format=txt`}>TXT</a><a href={`/api/creative-generation/jobs/${encodeURIComponent(jobId)}/ad-copy?format=json`}>JSON</a><a href={`/api/creative-generation/jobs/${encodeURIComponent(jobId)}/ad-copy?format=csv`}>CSV</a></> : null}
      </div>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </section>
  );
}

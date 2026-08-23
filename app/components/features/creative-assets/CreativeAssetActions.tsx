"use client";

import { useState } from "react";
import { getHookLabel } from "../../../lib/creative-assets/code";
import type { CreativeAsset, CreativeAssetSnapshot } from "../../../lib/creative-assets/types";
import type { CreativeContentNoteScope } from "../../../lib/creative-content-notes/types";

type DisplayAsset = CreativeAsset | CreativeAssetSnapshot;

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("복사하지 못했습니다.");
}

export function buildTrackedLandingUrl(landingUrl: string | undefined, utmContent: string) {
  const target = String(landingUrl || "").trim();
  if (!target) return "";
  try {
    const url = new URL(target);
    const tracking = new URLSearchParams(utmContent);
    tracking.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  } catch {
    const separator = target.includes("?") ? "&" : "?";
    return `${target}${separator}${utmContent}`;
  }
}

export async function markCreativeAssetExported(assetCode: string) {
  await fetch(`/api/creative-assets/${encodeURIComponent(assetCode)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "exported" }),
  }).catch(() => undefined);
}

export function CreativeAssetActions({ asset, compact = false, landingUrl, onMessage, downloadUrl }: { asset: DisplayAsset; compact?: boolean; landingUrl?: string; onMessage?: (message: string) => void; downloadUrl?: string }) {
  const [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [feedbackScope, setFeedbackScope] = useState<CreativeContentNoteScope>("product");
  const [promotionId, setPromotionId] = useState("");
  const trackedLandingUrl = buildTrackedLandingUrl(landingUrl, asset.utmContent);
  const hookLabel = getHookLabel(asset.hookCode || asset.hookType);
  const deliveryText = [`후킹: ${asset.hookCode} · ${hookLabel}${asset.mainMessage ? ` · ${asset.mainMessage}` : ""}`, `소재코드: ${asset.assetCode}`, `권장 광고명: ${asset.recommendedAdName}`, `UTM: ${asset.utmContent}`, trackedLandingUrl ? `최종 랜딩 URL: ${trackedLandingUrl}` : "", `파일명: ${asset.fileName}`].filter(Boolean).join("\n");

  function announce(next: string) {
    setMessage(next);
    onMessage?.(next);
    window.setTimeout(() => setMessage((current) => (current === next ? "" : current)), 2400);
  }

  async function copy(value: string, successMessage: string) {
    try {
      await writeClipboard(value);
      announce(successMessage);
    } catch {
      announce("복사에 실패했습니다. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(downloadUrl || asset.generatedImageUrl);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await markCreativeAssetExported(asset.assetCode);
      announce("소재 이미지를 다운로드했습니다.");
    } catch {
      announce("이미지 다운로드에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDownloading(false);
    }
  }

  async function saveHookFeedback(sentiment: "positive" | "negative") {
    const response = await fetch(`/api/creative-assets/${encodeURIComponent(asset.assetCode)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: { sentiment, scope: feedbackScope, promotionId: promotionId.trim() } }),
    });
    const payload = (await response.json()) as { error?: string };
    announce(response.ok ? (sentiment === "positive" ? "이 후킹을 다음 제작의 선호 참고사항으로 저장했습니다." : "이 후킹을 다음 제작의 제외 참고사항으로 저장했습니다.") : payload.error || "피드백 저장에 실패했습니다.");
  }

  return (
    <div className={`creative-asset-meta ${compact ? "compact" : ""}`}>
      <div className="creative-asset-code-row">
        <span>{getHookLabel(asset.hookCode || asset.hookType)}</span>
        <code title="이 코드를 Meta 광고 이름에 포함하면 향후 광고 보고서와 소재 성과를 자동으로 연결할 수 있습니다.">{asset.assetCode}</code>
        {asset.version > 1 ? <b>v{asset.version}</b> : null}
      </div>
      {!compact ? (
        <>
          <small>이 코드를 Meta 광고 이름에 포함하면 향후 광고 보고서와 소재 성과를 자동으로 연결할 수 있습니다.</small>
          <dl className="creative-asset-delivery">
            <div>
              <dt>후킹</dt>
              <dd>
                {asset.hookCode} · {hookLabel}
                {asset.mainMessage ? ` · ${asset.mainMessage}` : ""}
              </dd>
            </div>
            <div>
              <dt>소재코드</dt>
              <dd>
                <code>{asset.assetCode}</code>
              </dd>
            </div>
            <div>
              <dt>권장 광고명</dt>
              <dd>
                <code>{asset.recommendedAdName}</code>
              </dd>
            </div>
            <div>
              <dt>UTM</dt>
              <dd>
                <code>{asset.utmContent}</code>
              </dd>
            </div>
            {trackedLandingUrl ? (
              <div>
                <dt>최종 랜딩 URL</dt>
                <dd>
                  <code>{trackedLandingUrl}</code>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>파일명</dt>
              <dd>
                <code>{asset.fileName}</code>
              </dd>
            </div>
          </dl>
        </>
      ) : null}
      <div className="creative-asset-buttons">
        <button onClick={() => void copy(asset.assetCode, "소재코드를 복사했습니다.")} type="button">
          소재코드 복사
        </button>
        <button onClick={() => void copy(asset.recommendedAdName, "광고 이름을 복사했습니다.")} type="button">
          광고명 복사
        </button>
        <button onClick={() => void copy(asset.utmContent, "UTM 값을 복사했습니다.")} type="button">
          UTM 복사
        </button>
        {trackedLandingUrl ? (
          <button onClick={() => void copy(trackedLandingUrl, "UTM이 포함된 랜딩 URL을 복사했습니다.")} type="button">
            최종 URL 복사
          </button>
        ) : null}
        {!compact ? (
          <button onClick={() => void copy(deliveryText, "후킹·소재코드·UTM 전달정보를 복사했습니다.")} type="button">
            전달정보 전체 복사
          </button>
        ) : null}
        <button className="creative-asset-download-button" disabled={downloading} onClick={() => void download()} type="button">
          {downloading ? "다운로드 중…" : "이미지 다운로드"}
        </button>
        {!compact && asset.advertiserId ? (
          <>
            <label className="creative-asset-feedback-scope">
              <span>다음 제작 반영 범위</span>
              <select onChange={(event) => setFeedbackScope(event.target.value as CreativeContentNoteScope)} value={feedbackScope}>
                <option value="product">이 상품만</option>
                <option value="category">이 카테고리</option>
                <option value="advertiser">이 광고주 전체</option>
                <option value="promotion">이번 프로모션만</option>
              </select>
            </label>
            {feedbackScope === "promotion" ? <input aria-label="프로모션 ID" onChange={(event) => setPromotionId(event.target.value)} placeholder="프로모션 ID" value={promotionId} /> : null}
            <button onClick={() => void saveHookFeedback("positive")} type="button">
              이 후킹 유지
            </button>
            <button onClick={() => void saveHookFeedback("negative")} type="button">
              다음엔 제외
            </button>
          </>
        ) : null}
      </div>
      {message ? (
        <p aria-live="polite" className="creative-asset-toast" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

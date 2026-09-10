"use client";

/* Public and locally captured site images intentionally bypass Next image optimization. */
/* eslint-disable @next/next/no-img-element */

import type { ProductInfoForPrompt, SiteVisualRole, SiteVisualSelection } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

function compact(value: string | undefined, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function siteVisuals(product: ProductInfoForPrompt, imagePaths: string[] = []) {
  const labels = new Map((product.sourceImageCandidates || []).map((candidate) => [candidate.imagePath, candidate.label]));
  const paths = Array.from(new Set([
    product.extractedMainImage,
    ...(product.extractedGalleryImages || []),
    ...(product.sourceImageCandidates || []).map((candidate) => candidate.imagePath),
    ...imagePaths,
    product.productImagePath,
  ].filter((value): value is string => Boolean(value?.trim()))));
  return paths.map((path, index) => ({ path, label: labels.get(path) || `사이트 시각 자료 ${index + 1}` }));
}

function insightList(values: string[], emptyText: string) {
  if (!values.length) return <p className={styles.siteEmptyInsight}>{emptyText}</p>;
  return <ul>{values.slice(0, 6).map((value) => <li key={value}>{value}</li>)}</ul>;
}

export function SiteAnalysisSummary(props: {
  product: ProductInfoForPrompt;
  loaded: boolean;
  imagePaths?: string[];
  onChooseOther?: () => void;
  onUseSite?: () => void;
  onVisualSelectionsChange?: (selections: SiteVisualSelection[]) => void;
  selectedForGeneration?: boolean;
}) {
  if (!props.loaded) return null;
  const visuals = siteVisuals(props.product, props.imagePaths);
  const analysis = props.product.siteAnalysis;
  const description = compact(analysis?.oneLineSummary || props.product.extractedDescription || props.product.mainBenefit, 320);
  const pageCount = analysis?.analyzedPageCount || 1;
  const selections = props.product.siteVisualSelections || [];
  const selectionByPath = new Map(selections.map((selection) => [selection.imagePath, selection]));
  const selectionCounts = selections.reduce<Record<SiteVisualRole, number>>(
    (counts, selection) => ({ ...counts, [selection.role]: counts[selection.role] + 1 }),
    { logo: 0, mascot: 0, feature: 0 }
  );

  function toggleVisualRole(visual: { path: string; label: string }, role: SiteVisualRole) {
    const existing = selectionByPath.get(visual.path);
    const remaining = selections.filter((selection) => selection.imagePath !== visual.path);
    props.onVisualSelectionsChange?.(
      existing?.role === role ? remaining : [...remaining, { imagePath: visual.path, label: visual.label, role }]
    );
  }

  return (
    <section className={styles.siteConfirmation} aria-label="분석한 사이트 확인">
      <header className={styles.siteConfirmationHeader}>
        <div>
          <span className={styles.sectionStep}>사이트 전체 분석 완료</span>
          <h4>{analysis?.siteName || props.product.brandName || props.product.productName || "사이트 분석 완료"}</h4>
          {description ? <p>{description}</p> : null}
          {analysis?.businessModel ? <small>{compact(analysis.businessModel, 340)}</small> : null}
        </div>
        <strong>{pageCount}개 페이지 · 시각 자료 {visuals.length}개</strong>
      </header>

      {analysis ? (
        <div className={styles.siteInsightGrid}>
          <article>
            <span>제공 서비스</span>
            {insightList(analysis.offerings, "공개 페이지에서 서비스 항목을 확인하지 못했습니다.")}
          </article>
          <article>
            <span>핵심 가치</span>
            {insightList(analysis.coreValueProps, "사이트 핵심 문구를 기준으로 확인이 필요합니다.")}
          </article>
          <article className={styles.siteTargetCard}>
            <span>우선 타겟</span>
            {analysis.targetPriorities.length ? (
              <ol>
                {analysis.targetPriorities.slice(0, 6).map((target) => (
                  <li key={`${target.rank}-${target.name}`}>
                    <b>{target.rank}</b>
                    <div><strong>{target.name}</strong><small>{target.reason}</small></div>
                    <em data-fit={target.fit}>{target.fit === "high" ? "높음" : target.fit === "medium" ? "보통" : "낮음"}</em>
                  </li>
                ))}
              </ol>
            ) : <p className={styles.siteEmptyInsight}>타겟 근거를 충분히 확인하지 못했습니다.</p>}
          </article>
          <article className={styles.siteDirectionCard}>
            <span>추천 광고 방향</span>
            {analysis.adDirections.length ? (
              <ul>
                {analysis.adDirections.slice(0, 4).map((direction) => (
                  <li key={`${direction.target}-${direction.angle}`}>
                    <strong>{direction.target}</strong>
                    <p>{direction.angle}</p>
                    <small>“{direction.sampleMessage}”</small>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.siteEmptyInsight}>타겟 분석 후 광고 방향을 확인할 수 있습니다.</p>}
          </article>
        </div>
      ) : null}

      {analysis ? (
        <details className={styles.siteAnalysisDetails}>
          <summary>분석 근거와 추가 항목 보기</summary>
          <div>
            <section><h5>고객 문제</h5>{insightList(analysis.customerProblems, "확인된 항목 없음")}</section>
            <section><h5>차별점</h5>{insightList(analysis.differentiators, "확인된 항목 없음")}</section>
            <section><h5>신뢰 근거</h5>{insightList(analysis.trustSignals, "확인된 항목 없음")}</section>
            <section><h5>전환 장치</h5>{insightList(analysis.conversionOffers, "확인된 항목 없음")}</section>
          </div>
          {analysis.cautions.length ? <p className={styles.siteAnalysisCaution}>확인 필요 · {analysis.cautions.join(" · ")}</p> : null}
          <p className={styles.siteAnalysisSources}>분석 페이지: {analysis.sourcePages.slice(0, 8).map((page) => page.title).filter(Boolean).join(" · ")}</p>
        </details>
      ) : null}

      <div className={styles.siteVisualHeading}>
        <div><strong>사이트 시각 자료 선택</strong><small>각 이미지를 로고, 마스코트 또는 기능 이미지로 지정해 주세요. 다시 누르면 선택이 해제됩니다.</small></div>
        <span>로고 {selectionCounts.logo} · 마스코트 {selectionCounts.mascot} · 기능 {selectionCounts.feature}</span>
      </div>
      {visuals.length ? (
        <div className={styles.siteImageGrid} aria-label={`수집한 사이트 시각 자료 ${visuals.length}개`}>
          {visuals.map((visual) => {
            const selectedRole = selectionByPath.get(visual.path)?.role;
            return (
            <figure data-selected={Boolean(selectedRole)} key={visual.path}>
              <img alt={visual.label} loading="lazy" src={visual.path} />
              <figcaption>{visual.label}</figcaption>
              <div className={styles.siteImageRoleControls} role="group" aria-label={`${visual.label} 용도 선택`}>
                {([
                  ["logo", "로고"],
                  ["mascot", "마스코트"],
                  ["feature", "기능 이미지"],
                ] as const).map(([role, label]) => (
                  <button
                    aria-pressed={selectedRole === role}
                    data-role={role}
                    key={role}
                    onClick={() => toggleVisualRole(visual, role)}
                    type="button"
                  >
                    {selectedRole === role ? "✓ " : ""}{label}
                  </button>
                ))}
              </div>
            </figure>
            );
          })}
        </div>
      ) : <p className={styles.siteImageNotice}>분석 가능한 텍스트는 확인했지만 제작에 사용할 시각 자료는 찾지 못했습니다.</p>}

      <p className={styles.siteImageNotice}>동일 도메인의 공개 페이지를 분석했으며, 사이트에 없는 성과·매출·고객 정보는 만들지 않습니다.</p>
      <div className={styles.productConfirmationActions}>
        <button disabled={props.selectedForGeneration || !visuals.length} onClick={props.onUseSite} type="button">
          {props.selectedForGeneration ? "사이트 선택 완료 · 아래에서 이미지 선택" : visuals.length ? "이 사이트로 광고 만들기" : "시각 자료가 없어 제작할 수 없음"}
        </button>
        <button onClick={props.onChooseOther} type="button">다른 사이트 선택</button>
      </div>
    </section>
  );
}

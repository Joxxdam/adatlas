"use client";

import type { AdImageAnalysisDraft, AdImageLabel, CollectedAdImage } from "../../../lib/mvp/types";

export type MetaCrawlItem = {
  brandName: string;
  imageUrl: string;
  localImagePath?: string;
  originalAdUrl: string;
  collectedAt: string;
};

export const categoryOptions = ["식품/선물", "뷰티/스킨케어", "패션/의류", "생활용품", "건강기능식품", "디지털/앱", "인테리어/리빙", "기타"];
export const hookTypeOptions = ["가격정당화형", "가격소구형", "문제제기형", "공감형", "후기/리뷰형", "UGC형", "비포애프터형", "전문가/권위형", "선물명분형", "긴급/한정형", "반전/궁금증형", "상황제안형"];
export const appealPointOptions = ["가성비", "선물명분", "고급감", "실속", "불편해소", "체형보완", "성분/효능", "시간절약", "후기신뢰", "희소성", "즉시혜택", "자기관리", "사회적 인정"];

const labelFields: { key: keyof AdImageAnalysisDraft; label: string }[] = [
  { key: "ocrText", label: "이미지 문구" },
  { key: "category", label: "카테고리" },
  { key: "hookType", label: "후킹 방식" },
  { key: "appealPoint", label: "핵심 소구점" },
  { key: "targetEmotion", label: "소비자 감정" },
  { key: "copyNuance", label: "카피 뉘앙스" },
  { key: "visualTone", label: "비주얼 톤" },
  { key: "layoutPattern", label: "레이아웃 구조" },
  { key: "whyItWorks", label: "왜 먹히는지" },
  { key: "recommendedUse", label: "응용 추천" },
];

const advancedLabelFields: { key: keyof AdImageAnalysisDraft; label: string }[] = [
  { key: "firstLineHook", label: "첫 문장 후킹" },
  { key: "copyStructure", label: "카피 구조" },
  { key: "toneOfVoice", label: "말투/톤" },
  { key: "trendElements", label: "트렌드 요소" },
  { key: "consumerInsight", label: "소비자 인사이트" },
  { key: "purchaseTrigger", label: "구매 트리거" },
  { key: "reusableCopyPattern", label: "재사용 카피 패턴" },
  { key: "visualCopyRelation", label: "비주얼-카피 연결" },
];

export function CrawledGrid({ items }: { items: MetaCrawlItem[] }) {
  return (
    <div className="mvp-image-grid">
      {items.map((item) => (
        <article key={`${item.imageUrl}-${item.originalAdUrl}`}>
          <img alt={`${item.brandName} 수집 광고 이미지`} src={item.localImagePath || item.imageUrl} />
          <div>
            <strong>{item.brandName}</strong>
            <span>{new Date(item.collectedAt).toLocaleString("ko-KR")}</span>
            {item.originalAdUrl ? (
              <a href={item.originalAdUrl} rel="noreferrer" target="_blank">
                광고 원본 보기
              </a>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function TaxonomyGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      <div>
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

type FilterBarProps = {
  appealPointFilter: string;
  categoryFilter: string;
  hookTypeFilter: string;
  labelStateFilter: string;
  platformFilter: string;
  setAppealPointFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setHookTypeFilter: (value: string) => void;
  setLabelStateFilter: (value: string) => void;
  setPlatformFilter: (value: string) => void;
};

export function FilterBar({ appealPointFilter, categoryFilter, hookTypeFilter, labelStateFilter, platformFilter, setAppealPointFilter, setCategoryFilter, setHookTypeFilter, setLabelStateFilter, setPlatformFilter }: FilterBarProps) {
  return (
    <div className="taxonomy-filters">
      <label>
        <span>카테고리</span>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">전체</option>
          {categoryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>소구점</span>
        <select value={appealPointFilter} onChange={(event) => setAppealPointFilter(event.target.value)}>
          <option value="all">전체</option>
          {appealPointOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>후킹 유형</span>
        <select value={hookTypeFilter} onChange={(event) => setHookTypeFilter(event.target.value)}>
          <option value="all">전체</option>
          {hookTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>플랫폼</span>
        <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="meta">meta</option>
          <option value="tiktok">tiktok</option>
          <option value="manual">manual</option>
        </select>
      </label>
      <label>
        <span>라벨 상태</span>
        <select value={labelStateFilter} onChange={(event) => setLabelStateFilter(event.target.value)}>
          <option value="all">전체</option>
          <option value="needed">라벨 필요</option>
          <option value="done">라벨 완료</option>
        </select>
      </label>
    </div>
  );
}

type ImageGridProps = {
  images: CollectedAdImage[];
  labelsByImageId: Map<string, AdImageLabel>;
  onAnalyze: (image: CollectedAdImage) => void;
  onMetadataSave: (image: CollectedAdImage, updates: Partial<CollectedAdImage>) => void;
  onSelect: (image: CollectedAdImage) => void;
  selectedImageId?: string;
  showAnalysis?: boolean;
};

export function ImageGrid({ images, labelsByImageId, onAnalyze, onMetadataSave, onSelect, selectedImageId, showAnalysis = false }: ImageGridProps) {
  return (
    <div className="mvp-image-grid">
      {images.map((image) => {
        const existingLabel = labelsByImageId.get(image.id);
        const displayCategory = existingLabel?.finalLabel.category || image.category || "기타";
        const displayHookType = existingLabel?.finalLabel.hookType || image.hookType || "";
        const displayAppealPoint = existingLabel?.finalLabel.appealPoint || image.appealPoint || "";

        return (
          <article className={selectedImageId === image.id ? "selected" : ""} key={image.id} onClick={() => onSelect(image)}>
            <div className={`label-badge ${existingLabel ? "done" : "needed"}`}>{existingLabel ? "라벨 완료" : "라벨 필요"}</div>
            <img alt={`${image.category || "광고"} 이미지`} src={image.localImagePath || image.imageUrl} />
            <div>
              <strong>{displayCategory}</strong>
              <span>
                {displayHookType || "후킹 미지정"} / {displayAppealPoint || "소구점 미지정"} / {image.sourcePlatform}
              </span>
              <div className="metadata-editor" onClick={(event) => event.stopPropagation()}>
                <select aria-label="카테고리" defaultValue={displayCategory} onChange={(event) => onMetadataSave(image, { category: event.target.value })}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select aria-label="후킹 유형" defaultValue={displayHookType} onChange={(event) => onMetadataSave(image, { hookType: event.target.value })}>
                  <option value="">후킹 유형</option>
                  {hookTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select aria-label="소구점" defaultValue={displayAppealPoint} onChange={(event) => onMetadataSave(image, { appealPoint: event.target.value })}>
                  <option value="">소구점</option>
                  {appealPointOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="브랜드명 optional"
                  defaultValue={image.brandName}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value !== image.brandName) onMetadataSave(image, { brandName: value });
                  }}
                  placeholder="브랜드명 optional"
                />
                <select
                  aria-label="플랫폼"
                  defaultValue={String(image.sourcePlatform).toLowerCase()}
                  onChange={(event) => onMetadataSave(image, { sourcePlatform: event.target.value as CollectedAdImage["sourcePlatform"] })}
                >
                  <option value="meta">meta</option>
                  <option value="tiktok">tiktok</option>
                  <option value="manual">manual</option>
                </select>
              </div>
              {showAnalysis && existingLabel ? <p>{existingLabel.finalLabel.copyNuance || existingLabel.finalLabel.hookType}</p> : null}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onAnalyze(image);
                }}
                type="button"
              >
                {existingLabel ? "재분석하기" : "AI 분석하기"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type LabelPanelProps = {
  aiDraft: AdImageAnalysisDraft;
  finalLabel: AdImageAnalysisDraft;
  hasExistingLabel: boolean;
  image: CollectedAdImage | null;
  onAnalyze: (image: CollectedAdImage) => void;
  onDraftChange: (draft: AdImageAnalysisDraft) => void;
  onSave: () => void;
  status: { kind: "idle" | "loading" | "success" | "error"; message: string };
};

export function LabelPanel({ aiDraft, finalLabel, hasExistingLabel, image, onAnalyze, onDraftChange, onSave, status }: LabelPanelProps) {
  return (
    <aside className="label-panel">
      {image ? (
        <>
          <div className="label-preview">
            <img alt={`${image.category || "광고"} 라벨 편집 이미지`} src={image.localImagePath || image.imageUrl} />
            <div>
              <p className="eyebrow">Ad Image Label</p>
              <h3>{finalLabel.category || image.category || "기타"}</h3>
              <span>
                {finalLabel.hookType || image.hookType || "후킹 미지정"} / {finalLabel.appealPoint || image.appealPoint || "소구점 미지정"} / {image.sourcePlatform}
              </span>
            </div>
          </div>
          <div className={`mvp-status ${status.kind}`}>{status.message}</div>
          <div className="label-actions">
            <button onClick={() => onAnalyze(image)} type="button">
              {hasExistingLabel ? "재분석하기" : "AI 분석하기"}
            </button>
            <button onClick={onSave} type="button">
              라벨 저장
            </button>
          </div>
          <section className="ai-draft-box">
            <h4>AI 분석 초안</h4>
            <p>{aiDraft.whyItWorks || "아직 분석 초안이 없습니다."}</p>
          </section>
          <form className="label-form">
            <h4>기본 분석</h4>
            {labelFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.key === "category" || field.key === "hookType" || field.key === "appealPoint" ? (
                  <select onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })} value={finalLabel[field.key]}>
                    <option value="">선택</option>
                    {(field.key === "category" ? categoryOptions : field.key === "hookType" ? hookTypeOptions : appealPointOptions).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })} rows={field.key === "whyItWorks" || field.key === "recommendedUse" ? 4 : 3} value={finalLabel[field.key]} />
                )}
              </label>
            ))}
            <h4>심화 카피 분석</h4>
            {advancedLabelFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <textarea onChange={(event) => onDraftChange({ ...finalLabel, [field.key]: event.target.value })} rows={field.key === "reusableCopyPattern" || field.key === "visualCopyRelation" ? 4 : 3} value={finalLabel[field.key]} />
              </label>
            ))}
          </form>
        </>
      ) : (
        <div className="empty-label-panel">
          <p className="eyebrow">Ad Image Label</p>
          <h3>이미지를 선택하세요</h3>
          <p>이미지 카드에서 AI 분석 초안을 만들고 최종 라벨로 저장할 수 있습니다.</p>
        </div>
      )}
    </aside>
  );
}

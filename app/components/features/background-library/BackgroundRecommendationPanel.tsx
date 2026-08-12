"use client";

/* eslint-disable @next/next/no-img-element -- local, validated WebP previews */

import { useMemo, useState } from "react";
import type {
  AudienceAgeGroup,
  AudienceProfile,
  AutomaticLayoutPreset,
  BackgroundCategory,
  BackgroundLibraryItem,
  BackgroundRecommendation,
} from "../../../lib/background-library/types";

import styles from "./BackgroundRecommendationPanel.module.css";

const categoryLabels: Record<BackgroundCategory, string> = {
  fashion: "패션",
  beauty: "뷰티",
  health: "건강",
  agriculture: "농산물",
  meat: "육류",
  seafood: "수산물",
  "processed-food": "가공식품",
  "food-mall": "종합 식품몰",
  living: "리빙",
  kids: "키즈",
  pet: "반려동물",
  promotion: "프로모션",
};

const ageLabels: Record<AudienceAgeGroup, string> = {
  teens: "10대",
  twenties: "20대",
  thirties: "30대",
  forties: "40대",
  fifties: "50대",
  senior: "시니어",
  kids: "아이",
  family: "가족",
  couple: "커플",
  friends: "친구",
  no_people: "인물 없음",
};

function assetTypeLabel(recommendation: BackgroundRecommendation) {
  const type = recommendation.background.assetType;
  if (type === "people_photo") return "인물형";
  if (type === "lifestyle_photo") return "실사 공간형";
  if (type === "product_set") return "촬영 세트형";
  if (["ingredient_scene", "pattern_texture", "designed_asset", "ai_generated"].includes(type)) {
    return "콘텐츠형";
  }
  return type === "user_uploaded" ? "직접 추가" : "콘텐츠형";
}

function peopleLabel(recommendation: BackgroundRecommendation) {
  const item = recommendation.background;
  if (!item.includesPerson) return "인물 없음";
  const age = recommendation.audienceMatchLabels?.[0] || ageLabels[item.ageGroups[0]] || "인물";
  return `${age} · ${item.peopleCount}명`;
}

function fallbackLayout(item: BackgroundLibraryItem): AutomaticLayoutPreset {
  if (item.recommendedLayouts?.[0]) return item.recommendedLayouts[0];
  if (item.includesPerson) return "people-scene";
  if (item.assetType === "ingredient_scene") return "ingredient-story";
  if (item.category === "fashion") return "fashion-lookbook";
  if (item.textSafeArea.includes("left")) return "text-left-product-right";
  if (item.textSafeArea.includes("right")) return "text-right-product-left";
  if (item.textSafeArea.startsWith("bottom")) return "text-bottom-product-top";
  return "text-top-product-bottom";
}

function directRecommendation(item: BackgroundLibraryItem): BackgroundRecommendation {
  return {
    background: item,
    score: 0,
    matchScore: 0,
    diversityScore: 0,
    reasons: ["라이브러리에서 직접 선택"],
    connectionLabel: ["lifestyle_photo", "people_photo"].includes(item.assetType)
      ? "실사형"
      : "콘텐츠형",
    audienceMatchLabels: item.ageGroups.filter((age) => age !== "no_people").map((age) => ageLabels[age]),
    automaticLayout: fallbackLayout(item),
  };
}

export function BackgroundRecommendationPanel(props: {
  recommendations: BackgroundRecommendation[];
  audienceProfile: AudienceProfile | null;
  selectedBackgroundId: string;
  loading: boolean;
  status: string;
  onSelectBackground: (item: BackgroundRecommendation) => void;
  onRefresh: () => void;
}) {
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<BackgroundLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [category, setCategory] = useState<"all" | BackgroundCategory>("all");
  const [contentType, setContentType] = useState<"all" | "photo" | "content">("all");
  const [person, setPerson] = useState<"all" | "yes" | "no">("all");
  const [age, setAge] = useState<"all" | AudienceAgeGroup>("all");
  const [brightness, setBrightness] = useState<"all" | "bright" | "dark">("all");
  const [source, setSource] = useState<"all" | "user_uploaded">("all");
  const [brokenIds, setBrokenIds] = useState<string[]>([]);

  async function openLibrary() {
    setShowLibrary(true);
    if (library.length || libraryLoading) return;
    setLibraryLoading(true);
    try {
      const response = await fetch("/api/background-library/recommend");
      const result = await response.json();
      if (response.ok && result.ok && Array.isArray(result.items)) setLibrary(result.items);
    } finally {
      setLibraryLoading(false);
    }
  }

  const visible = useMemo(() => {
    const candidates = showLibrary
      ? library.map(directRecommendation)
      : props.recommendations.slice(0, 6);
    return candidates.filter(({ background: item }) => {
      if (brokenIds.includes(item.id)) return false;
      if (category !== "all" && item.category !== category) return false;
      if (
        contentType === "photo" &&
        !["lifestyle_photo", "people_photo"].includes(item.assetType)
      ) return false;
      if (
        contentType === "content" &&
        ["lifestyle_photo", "people_photo"].includes(item.assetType)
      ) return false;
      if (person === "yes" && !item.includesPerson) return false;
      if (person === "no" && item.includesPerson) return false;
      if (age !== "all" && !item.ageGroups.includes(age)) return false;
      if (brightness !== "all" && item.brightness !== brightness) return false;
      if (source !== "all" && item.sourceType !== source) return false;
      return true;
    });
  }, [age, brightness, brokenIds, category, contentType, library, person, props.recommendations, showLibrary, source]);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>MANUAL BACKGROUND OVERRIDE</span>
          <h4>배경 직접 바꾸기 <small>선택사항</small></h4>
          <p>자동 6장 생성은 각 후킹과 상품에 맞는 배경을 자동 적용합니다. 대표 소재의 배경을 직접 교체할 때만 사용하세요.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.refreshButton}
            disabled={props.loading || !props.recommendations.length}
            onClick={() => {
              setShowLibrary(false);
              props.onRefresh();
            }}
            type="button"
          >
            다른 배경 추천
          </button>
          <button
            className={styles.libraryButton}
            onClick={() => showLibrary ? setShowLibrary(false) : void openLibrary()}
            type="button"
          >
            {showLibrary ? "추천 배경만 보기" : "배경 전체 라이브러리"}
          </button>
        </div>
      </header>

      {props.audienceProfile ? (
        <div className={styles.audienceProfile}>
          <strong>자동 분석</strong>
          <span>{categoryLabels[props.audienceProfile.category]}</span>
          {props.audienceProfile.labels.map((label) => <span key={label}>{label}</span>)}
          <small>후킹에 따라 인물형·공간형·촬영 세트형·콘텐츠형의 순위를 다시 계산합니다.</small>
        </div>
      ) : null}

      <details className={styles.filterDetails}>
        <summary>배경 필터 열기</summary>
      <div className={styles.filters}>
        <label>카테고리
          <select onChange={(event) => setCategory(event.target.value as "all" | BackgroundCategory)} value={category}>
            <option value="all">전체</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>배경 유형
          <select onChange={(event) => setContentType(event.target.value as typeof contentType)} value={contentType}>
            <option value="all">전체</option><option value="photo">실사형</option><option value="content">콘텐츠형</option>
          </select>
        </label>
        <label>인물
          <select onChange={(event) => setPerson(event.target.value as typeof person)} value={person}>
            <option value="all">전체</option><option value="yes">있음</option><option value="no">없음</option>
          </select>
        </label>
        <label>연령
          <select onChange={(event) => setAge(event.target.value as "all" | AudienceAgeGroup)} value={age}>
            <option value="all">전체</option>
            {Object.entries(ageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>명암
          <select onChange={(event) => setBrightness(event.target.value as typeof brightness)} value={brightness}>
            <option value="all">전체</option><option value="bright">밝은 배경</option><option value="dark">어두운 배경</option>
          </select>
        </label>
        <button
          className={source === "user_uploaded" ? styles.filterSelected : ""}
          onClick={() => {
            void openLibrary();
            setSource((current) => current === "user_uploaded" ? "all" : "user_uploaded");
          }}
          type="button"
        >사용자 추가 배경</button>
      </div>
      </details>

      {props.loading || libraryLoading ? (
        <p className={styles.status}>저장된 배경을 비교하고 있습니다.</p>
      ) : visible.length ? (
        <div className={`${styles.cardGrid} ${showLibrary ? styles.libraryGrid : ""}`}>
          {visible.map((recommendation, index) => {
            const item = recommendation.background;
            const selected = item.id === props.selectedBackgroundId;
            return (
              <article className={`${styles.card} ${selected ? styles.cardSelected : ""}`} key={item.id}>
                <button className={styles.selectArea} onClick={() => props.onSelectBackground(recommendation)} type="button">
                  <span className={styles.imageWrap}>
                    <img alt={`${item.scene} 배경`} onError={() => setBrokenIds((current) => [...current, item.id])} src={item.file} />
                    <b>{selected ? "선택됨" : showLibrary ? categoryLabels[item.category] : `배경 ${index + 1}`}</b>
                    <em className={styles.connectionBadge}>{assetTypeLabel(recommendation)}</em>
                  </span>
                  <strong>{item.scene}</strong>
                  <span className={styles.meta}>{peopleLabel(recommendation)}</span>
                  <span className={styles.tags}>{item.mood.slice(0, 3).join(" · ")}</span>
                  <span className={styles.positions}>문구 {item.textSafeArea} · 상품 {item.productPosition}</span>
                  <span className={styles.selectLabel}>{selected ? "이 배경을 사용합니다" : "이 배경 선택"}</span>
                </button>
                <details className={styles.sourceDetails}>
                  <summary>출처·라이선스</summary>
                  <span>{item.sourceName || item.sourceType}</span>
                  {item.authorName ? <span>제작자: {item.authorName}</span> : null}
                  {item.sourcePageUrl ? <a href={item.sourcePageUrl} rel="noreferrer" target="_blank">원본 페이지</a> : null}
                  {item.licenseUrl ? <a href={item.licenseUrl} rel="noreferrer" target="_blank">라이선스</a> : null}
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.status}>{props.status || "조건에 맞는 배경이 없습니다. 필터를 변경해 주세요."}</p>
      )}
    </section>
  );
}

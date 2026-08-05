"use client";

/* eslint-disable @next/next/no-img-element -- local WebP and newly generated data-backed previews */

import type { SceneCandidate } from "../../../lib/creative/types";
import type { BackgroundRecommendation } from "../../../lib/background-library/types";

import styles from "./BackgroundRecommendationPanel.module.css";

export type BackgroundProductionMode = "library" | "ai";

export function BackgroundRecommendationPanel(props: {
  recommendations: BackgroundRecommendation[];
  selectedBackgroundId: string;
  loading: boolean;
  status: string;
  mode: BackgroundProductionMode;
  aiAvailable: boolean;
  aiCandidates: SceneCandidate[];
  selectedAiCandidateId: string;
  isGeneratingAi: boolean;
  savingAiCandidateId: string;
  onModeChange: (mode: BackgroundProductionMode) => void;
  onSelectBackground: (item: BackgroundRecommendation) => void;
  onGenerateAi: () => void;
  onSelectAi: (candidate: SceneCandidate) => void;
  onSaveAi: (candidate: SceneCandidate) => void;
}) {
  return (
    <section className={styles.panel}>
      <header>
        <div>
          <span className={styles.eyebrow}>BACKGROUND MATCH</span>
          <h4>상품·후킹에 맞는 배경 3안</h4>
          <p>후킹 전용 기본 배경을 먼저 고르고, 상세페이지 이미지와 업종 장면으로 보완합니다.</p>
        </div>
      </header>

      <div className={styles.modeGrid}>
        <button
          className={props.mode === "library" ? styles.modeSelected : ""}
          onClick={() => props.onModeChange("library")}
          type="button"
        >
          <strong>빠른 제작</strong>
          <span>저장된 검증 배경으로 바로 합성</span>
        </button>
        <button
          className={props.mode === "ai" ? styles.modeSelected : ""}
          disabled={!props.aiAvailable}
          onClick={() => props.onModeChange("ai")}
          type="button"
        >
          <strong>새 AI 배경 생성</strong>
          <span>
            {props.aiAvailable ? "선택한 후킹 전용 배경 생성" : "AI API 키 설정 시 사용 가능"}
          </span>
        </button>
      </div>

      {props.mode === "library" ? (
        props.loading ? (
          <p className={styles.status}>배경을 비교하고 있습니다.</p>
        ) : props.recommendations.length ? (
          <div className={styles.cardGrid}>
            {props.recommendations.slice(0, 3).map((recommendation, index) => {
              const item = recommendation.background;
              const selected = item.id === props.selectedBackgroundId;
              return (
                <button
                  className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
                  key={item.id}
                  onClick={() => props.onSelectBackground(recommendation)}
                  type="button"
                >
                  <span className={styles.imageWrap}>
                    <img
                      alt={`${item.scene} 배경`}
                      className={
                        recommendation.intendedTreatment === "blurred-site-image"
                          ? styles.siteDerivedPreview
                          : ""
                      }
                      src={item.file}
                    />
                    <b>{selected ? "선택됨" : `배경 ${index + 1}`}</b>
                    <em className={styles.connectionBadge}>
                      {recommendation.connectionLabel || "업종 장면"}
                    </em>
                  </span>
                  <strong>{item.scene}</strong>
                  <span className={styles.tags}>{item.mood.slice(0, 3).join(" · ")}</span>
                  <small>{recommendation.reasons.join(" · ")}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className={styles.status}>
            {props.status || "후킹을 선택하면 배경 3안을 추천합니다."}
          </p>
        )
      ) : (
        <div className={styles.aiArea}>
          <div className={styles.aiHeader}>
            <p>상품·포장·문구 없이, 합성 여백만 갖춘 1200×1200 배경을 만듭니다.</p>
            <button
              disabled={!props.aiAvailable || props.isGeneratingAi}
              onClick={props.onGenerateAi}
              type="button"
            >
              {props.isGeneratingAi ? "AI 배경 생성 중" : "새 배경 만들기"}
            </button>
          </div>
          {props.aiCandidates.length ? (
            <div className={styles.cardGrid}>
              {props.aiCandidates.map((candidate, index) => (
                <article
                  className={`${styles.card} ${candidate.id === props.selectedAiCandidateId ? styles.cardSelected : ""}`}
                  key={candidate.id}
                >
                  <button
                    className={styles.aiSelect}
                    onClick={() => props.onSelectAi(candidate)}
                    type="button"
                  >
                    <span className={styles.imageWrap}>
                      <img alt={`AI 배경 ${index + 1}`} src={candidate.imagePath} />
                      <b>
                        {candidate.id === props.selectedAiCandidateId
                          ? "선택됨"
                          : `AI ${index + 1}`}
                      </b>
                    </span>
                    <strong>{candidate.sceneType}</strong>
                  </button>
                  <button
                    className={styles.saveButton}
                    disabled={props.savingAiCandidateId === candidate.id}
                    onClick={() => props.onSaveAi(candidate)}
                    type="button"
                  >
                    {props.savingAiCandidateId === candidate.id ? "저장 중" : "라이브러리에 보관"}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.status}>{props.status}</p>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import type {
  SceneCandidate,
  SceneGenerationProviderId,
  VisualDirection,
} from "../../../lib/creative/types";
import { SceneCandidateCard } from "./SceneCandidateCard";
import styles from "./SceneGeneration.module.css";

type BlurLevel = "low" | "medium" | "high";

export function SceneGenerationPanel(props: {
  direction: VisualDirection | null;
  candidates: SceneCandidate[];
  selectedCandidateId: string;
  provider: SceneGenerationProviderId;
  candidateCount: number;
  loading: boolean;
  status: string;
  brightness: number;
  blurLevel: BlurLevel;
  overlayOpacity: number;
  onProviderChange: (value: SceneGenerationProviderId) => void;
  onCandidateCountChange: (value: number) => void;
  onGenerate: () => void;
  onSelect: (candidate: SceneCandidate) => void;
  onBrightnessChange: (value: number) => void;
  onBlurChange: (value: BlurLevel) => void;
  onOverlayChange: (value: number) => void;
}) {
  return (
    <section className={styles.panel}>
      <header>
        <div>
          <span>AI SCENE</span>
          <h4>글씨 없는 광고 장면</h4>
        </div>
        <button disabled={!props.direction || props.loading} onClick={props.onGenerate} type="button">
          {props.loading ? "생성 중" : props.candidates.length ? "장면 다시 생성" : "장면 생성"}
        </button>
      </header>
      <div className={styles.compactControls}>
        <label>
          <span>생성 엔진</span>
          <select
            onChange={(event) => props.onProviderChange(event.target.value as SceneGenerationProviderId)}
            value={props.provider}
          >
            <option value="openai">OpenAI 고품질</option>
            <option value="gemini">Gemini</option>
            <option value="mock">안전 배경</option>
          </select>
        </label>
        <label>
          <span>후보</span>
          <select
            onChange={(event) => props.onCandidateCountChange(Number(event.target.value))}
            value={props.candidateCount}
          >
            <option value={2}>2개</option>
            <option value={3}>3개</option>
          </select>
        </label>
      </div>
      {props.candidates.length ? (
        <div className={styles.candidateGrid}>
          {props.candidates.map((candidate) => (
            <SceneCandidateCard
              candidate={candidate}
              key={candidate.id}
              onSelect={() => props.onSelect(candidate)}
              selected={props.selectedCandidateId === candidate.id}
            />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>
          {props.direction ? "선택한 방향으로 장면을 생성하세요." : "먼저 비주얼 방향을 선택하세요."}
        </p>
      )}
      <details className={styles.advanced}>
        <summary>배경 세부 조정</summary>
        <div>
          <label>
            <span>밝기 {props.brightness.toFixed(2)}</span>
            <input
              max="1.25"
              min="0.65"
              onChange={(event) => props.onBrightnessChange(Number(event.target.value))}
              step="0.05"
              type="range"
              value={props.brightness}
            />
          </label>
          <label>
            <span>흐림</span>
            <select
              onChange={(event) => props.onBlurChange(event.target.value as BlurLevel)}
              value={props.blurLevel}
            >
              <option value="low">낮음</option>
              <option value="medium">중간</option>
              <option value="high">강함</option>
            </select>
          </label>
          <label>
            <span>오버레이 {Math.round(props.overlayOpacity * 100)}%</span>
            <input
              max="0.45"
              min="0"
              onChange={(event) => props.onOverlayChange(Number(event.target.value))}
              step="0.05"
              type="range"
              value={props.overlayOpacity}
            />
          </label>
        </div>
      </details>
      {props.status ? <p className={styles.status}>{props.status}</p> : null}
    </section>
  );
}

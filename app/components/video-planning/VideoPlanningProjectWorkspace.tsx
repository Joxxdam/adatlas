"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  VIDEO_CONCEPT_ARCHETYPE_OPTIONS,
  type VideoProject,
} from "../../lib/video-collaboration/types";
import { getVideoPlanningBlueprint } from "../../lib/video-collaboration/videoPlanningBlueprints";
import { getVideoParodyGenre } from "../../lib/video-collaboration/videoParodyGenres";
import { VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoPlanning.module.css";

export function VideoPlanningProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/video-projects/${projectId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "영상 기획을 불러오지 못했습니다.");
    const nextProject = payload.project as VideoProject;
    setProject(nextProject);
    const generationRunning = nextProject.pipelineProgress?.some(
      (item) => item.status === "running"
    );
    if (
      !nextProject.concepts.length &&
      !generationRunning &&
      nextProject.generationFailure?.message
    ) {
      setError(nextProject.generationFailure.message);
    } else {
      setError("");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .catch((caught) => setError(caught instanceof Error ? caught.message : "조회 실패"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const generationRunning = project?.pipelineProgress?.some(
      (item) => item.status === "running"
    );
    if (!project || project.concepts.length || !generationRunning) return;
    const interval = window.setInterval(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "진행 상태 조회 실패")
      );
    }, 3000);
    return () => window.clearInterval(interval);
  }, [load, project]);

  async function generate() {
    setBusy(true);
    setGenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: project?.marketerName || "마케터" }),
      });
      const payload = await response.json();
      if (!response.ok && payload.failure?.code === "GENERATION_ALREADY_RUNNING") {
        await load();
        return;
      }
      if (!response.ok) throw new Error(payload.error || "영상 기획 생성에 실패했습니다.");
      setProject(payload.project);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 생성 실패");
    } finally {
      setGenerating(false);
      setBusy(false);
    }
  }

  async function selectConcept(conceptId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "select-concept",
          conceptId,
          actor: project?.marketerName || "마케터",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "콘셉트를 선택하지 못했습니다.");
      setProject(payload.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "콘셉트 선택 실패");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    if (!project) return;
    if (
      !window.confirm(
        `“${project.projectName}” 영상 기획 전체를 삭제할까요?\n삭제한 기획과 프로젝트 전용 제작 파일은 복구할 수 없습니다.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "영상 기획을 삭제하지 못했습니다.");
      router.replace("/video-planning");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 삭제 실패");
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>영상 기획을 불러오는 중입니다.</div>
      </main>
    );
  if (!project)
    return (
      <main className={styles.page}>
        <div className={styles.error}>{error || "프로젝트를 찾지 못했습니다."}</div>
      </main>
    );

  const storedGenerationRunning = Boolean(
    project.pipelineProgress?.some((item) => item.status === "running")
  );
  const generationRunning = generating || storedGenerationRunning;
  const completedGenerationStages =
    project.pipelineProgress?.filter((item) => item.status === "complete").length || 0;
  const runningGenerationStage = project.pipelineProgress?.find(
    (item) => item.status === "running"
  );
  const generationFailureReason =
    project.generationFailure?.code === "CONCEPTS_NOT_DISTINCT"
      ? "필수 4개 유형 중 하나가 누락·중복됐거나, 기획안 사이의 첫 문장·사건·화자·소구·화면 스타일이 품질 기준보다 겹쳤습니다. 상품 분석이나 API 연결 실패는 아닙니다."
      : project.generationFailure?.code === "PARODY_GENRE_MISMATCH"
        ? "사건·상황극 기획이 자동 선택된 세부 장르의 인물·사건·화면 문법을 충분히 따르지 못했습니다."
        : "API 응답 또는 생성 결과가 저장 전 품질검사를 통과하지 못했습니다.";

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href="/video-planning">← 영상 기획 목록</Link>
          <p className={styles.eyebrow}>VIDEO PLAN</p>
          <h1>{project.projectName}</h1>
          <p>
            {project.productAnalysis.productName} · {project.duration}초 · 자막과 장면안
          </p>
        </div>
        <div className={styles.topActions}>
          <span className={styles.status}>{VIDEO_STATUS_LABELS[project.status]}</span>
          {[
            "production_requested",
            "in_production",
            "marketer_review",
            "revision_requested",
            "approved",
          ].includes(project.status) ? (
            <Link
              className={styles.secondaryButton}
              href={`/video-planning/${project.id}/production`}
            >
              제작·검수
            </Link>
          ) : null}
          <Link className={styles.primaryButton} href="/video-planning/new">
            새 영상 기획
          </Link>
          <button
            className={styles.dangerButton}
            disabled={busy}
            onClick={() => void deleteProject()}
            type="button"
          >
            {busy ? "처리 중…" : "기획 삭제"}
          </button>
        </div>
      </header>

      {generationRunning ? (
        <section
          aria-live="polite"
          aria-label="영상 기획 생성 진행 상황"
          className={styles.generationRunningPanel}
          role="status"
        >
          <div className={styles.generationSpinner} aria-hidden="true" />
          <div className={styles.generationRunningCopy}>
            <span>AI VIDEO PLANNING</span>
            <h2>영상 기획 4안을 생성하고 있습니다</h2>
            <p>
              {runningGenerationStage?.message ||
                "요청을 전송했습니다. 상품 근거를 바탕으로 서로 다른 기획안을 구성하는 중입니다."}
              <br />완료되면 이 화면에 자동으로 표시됩니다. 페이지를 닫지 않고 기다려 주세요.
            </p>
          </div>
          <div className={styles.generationRunningCount}>
            <strong>{completedGenerationStages}/4 단계</strong>
            <span>자동 갱신 중</span>
          </div>
          <div className={styles.generationProgressTrack} aria-hidden="true">
            <span
              style={{
                width: `${Math.max(8, (completedGenerationStages / 4) * 100)}%`,
              }}
            />
          </div>
        </section>
      ) : null}

      {error && !generationRunning ? (
        <div className={styles.error}>
          <strong>영상 기획을 만들지 못했습니다.</strong>
          {error}
          {project.generationFailure ? (
            <p className={styles.failureReason}>
              <b>실패 원인</b>
              {generationFailureReason}
            </p>
          ) : null}
          <div className={styles.errorActions}>
            <button className={styles.secondaryButton} disabled={busy} onClick={generate}>
              다시 시도
            </button>
          </div>
        </div>
      ) : null}

      <section className={styles.productSummaryBar}>
        <div>
          <span>상품</span>
          <strong>{project.productAnalysis.productName}</strong>
          <small>{project.advertiserName}</small>
        </div>
        <div className={styles.productFactChips}>
          {[...project.productAnalysis.coreUsps, ...project.productAnalysis.keyFeatures]
            .slice(0, 4)
            .map((fact, index) => (
              <span key={`${index}-${fact}`}>{fact}</span>
            ))}
        </div>
        <a
          className={styles.ghostButton}
          href={project.productUrl}
          rel="noreferrer"
          target="_blank"
        >
          상세페이지 보기
        </a>
      </section>

      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>서로 다른 영상 콘셉트 4안</h2>
            <p>
              요약만 비교하고, 자세히 연 콘셉트에 대해서만 15개 이상의 자막·장면안을 생성합니다.
            </p>
          </div>
          {!project.concepts.length ? (
            <button
              className={styles.primaryButton}
              disabled={busy || generationRunning}
              onClick={generate}
            >
              {generationRunning ? "4개 콘셉트 생성 중…" : "4개 콘셉트 다시 생성"}
            </button>
          ) : null}
        </div>
        {project.pipelineProgress?.length ? (
          <div className={styles.pipelineProgress}>
            {project.pipelineProgress.map((item) => (
              <span data-status={item.status} key={item.stage}>
                {item.message}
              </span>
            ))}
          </div>
        ) : null}
        {project.concepts.length ? (
          <div className={styles.conceptGrid}>
            {project.concepts.map((concept, conceptIndex) => {
              const archetype = VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find(
                (option) => option.id === concept.conceptArchetype
              );
              const parodyGenre = getVideoParodyGenre(concept.parodyGenre);
              const primaryBlueprint = getVideoPlanningBlueprint(
                concept.blueprintSelection?.primaryId
              );
              const secondaryBlueprint = getVideoPlanningBlueprint(
                concept.blueprintSelection?.secondaryId
              );
              const selected = project.selectedConceptId === concept.id;
              return (
                <article className={styles.conceptCard} data-selected={selected} key={concept.id}>
                  <div className={styles.conceptCardHead}>
                    <div>
                      <b>콘셉트 {String(conceptIndex + 1).padStart(2, "0")}</b>
                      <span className={styles.status}>
                        {archetype?.label || "영상 콘셉트"}
                        {parodyGenre ? ` · ${parodyGenre.label}` : ""}
                      </span>
                    </div>
                    {selected ? <b>선택됨</b> : null}
                  </div>
                  <h3>{concept.title}</h3>
                  <blockquote>{concept.openingHook}</blockquote>
                  <div className={styles.conceptSnapshot}>
                    <div>
                      <span>핵심 사건</span>
                      <strong>{concept.centralIncident || concept.narrativeSummary}</strong>
                    </div>
                    <div>
                      <span>화자</span>
                      <strong>{concept.speakerPointOfView || concept.speaker}</strong>
                    </div>
                    <div>
                      <span>핵심 소구</span>
                      <strong>{concept.keyAppeal || concept.usp}</strong>
                    </div>
                  </div>
                  {concept.benefitAvailability === "insufficient" ? (
                    <div className={styles.benefitWarning}>
                      확인 가능한 혜택 정보가 부족합니다. 가격·구성·배송 정보를 추가해 주세요.
                    </div>
                  ) : null}
                  <div className={styles.conceptActions}>
                    <Link
                      className={styles.primaryButton}
                      href={`/video-planning/${project.id}/concept/${concept.id}`}
                    >
                      기획안 자세히 보기
                    </Link>
                    <button
                      className={styles.secondaryButton}
                      disabled={busy || selected}
                      onClick={() => selectConcept(concept.id)}
                    >
                      {selected ? "선택 완료" : "이 콘셉트 선택"}
                    </button>
                  </div>
                  <details className={styles.conceptCardDetails}>
                    <summary>레퍼런스·기획 근거 보기</summary>
                    <div className={styles.conceptDetailsBody}>
                      {primaryBlueprint ? (
                        <div className={styles.blueprintSummary}>
                          <span>주 레퍼런스</span>
                          <strong>{primaryBlueprint.title}</strong>
                          <p>{concept.blueprintSelection?.reason}</p>
                          <div>
                            {primaryBlueprint.beats.map((beat) => (
                              <small key={`${primaryBlueprint.id}-${beat.role}`}>{beat.role}</small>
                            ))}
                          </div>
                          {secondaryBlueprint ? <em>보조: {secondaryBlueprint.title}</em> : null}
                        </div>
                      ) : null}
                      <dl>
                        <div>
                          <dt>추천 화면 스타일</dt>
                          <dd>{concept.recommendedVisualStyle || archetype?.description}</dd>
                        </div>
                        <div>
                          <dt>보조 표현</dt>
                          <dd>{concept.supportingDevices?.join(" · ") || "상품 근거 중심"}</dd>
                        </div>
                        <div>
                          <dt>다른 안과의 차이</dt>
                          <dd>{concept.differenceFromPrevious || "첫 사건과 화자 구성을 다르게 설계"}</dd>
                        </div>
                      </dl>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>아직 생성된 영상 기획이 없습니다.</div>
        )}
      </section>
    </main>
  );
}

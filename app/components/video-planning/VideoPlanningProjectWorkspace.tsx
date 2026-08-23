"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { VIDEO_CONCEPT_ARCHETYPE_OPTIONS, type VideoProject } from "../../lib/video-collaboration/types";
import { VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoPlanning.module.css";

export function VideoPlanningProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/video-projects/${projectId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "영상 기획을 불러오지 못했습니다.");
    setProject(payload.project);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .catch((caught) => setError(caught instanceof Error ? caught.message : "조회 실패"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: project?.marketerName || "마케터" }),
      });
      const payload = await response.json();
      if (!response.ok && payload.failure?.code === "GENERATION_ALREADY_RUNNING") {
        setError("같은 4개 콘셉트 생성이 이미 진행 중입니다. 완료 후 다시 확인해 주세요.");
        return;
      }
      if (!response.ok) throw new Error(payload.error || "영상 기획 생성에 실패했습니다.");
      setProject(payload.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 생성 실패");
    } finally {
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
          {["production_requested", "in_production", "marketer_review", "revision_requested", "approved"].includes(project.status) ? (
            <Link className={styles.secondaryButton} href={`/video-planning/${project.id}/production`}>
              제작·검수
            </Link>
          ) : null}
          <Link className={styles.primaryButton} href="/video-planning/new">
            새 영상 기획
          </Link>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>
          <strong>영상 기획을 만들지 못했습니다.</strong>
          {error}
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
          {[...project.productAnalysis.coreUsps, ...project.productAnalysis.keyFeatures].slice(0, 4).map((fact, index) => (
            <span key={`${index}-${fact}`}>{fact}</span>
          ))}
        </div>
        <a className={styles.ghostButton} href={project.productUrl} rel="noreferrer" target="_blank">
          상세페이지 보기
        </a>
      </section>

      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>서로 다른 영상 콘셉트 4안</h2>
            <p>요약만 비교하고, 자세히 연 콘셉트에 대해서만 15개 이상의 자막·장면안을 생성합니다.</p>
          </div>
          {!project.concepts.length ? (
            <button className={styles.primaryButton} disabled={busy} onClick={generate}>
              {busy ? "콘셉트 생성 중…" : "4개 콘셉트 다시 생성"}
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
            {project.concepts.map((concept) => {
              const archetype = VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((option) => option.id === concept.conceptArchetype);
              const selected = project.selectedConceptId === concept.id;
              return (
                <article className={styles.conceptCard} data-selected={selected} key={concept.id}>
                  <div className={styles.conceptCardHead}>
                    <span className={styles.status}>{archetype?.label || "영상 콘셉트"}</span>
                    {selected ? <b>선택됨</b> : null}
                  </div>
                  <h3>{concept.title}</h3>
                  <blockquote>{concept.openingHook}</blockquote>
                  <dl>
                    <div>
                      <dt>중심 사건</dt>
                      <dd>{concept.centralIncident || concept.narrativeSummary}</dd>
                    </div>
                    <div>
                      <dt>화자·시점</dt>
                      <dd>{concept.speakerPointOfView || concept.speaker}</dd>
                    </div>
                    <div>
                      <dt>핵심 소구</dt>
                      <dd>{concept.keyAppeal || concept.usp}</dd>
                    </div>
                    <div>
                      <dt>추천 화면 스타일</dt>
                      <dd>{concept.recommendedVisualStyle || archetype?.description}</dd>
                    </div>
                    <div>
                      <dt>보조 표현</dt>
                      <dd>{concept.supportingDevices?.join(" · ") || "상품 근거 중심"}</dd>
                    </div>
                    <div>
                      <dt>기존안과 차이</dt>
                      <dd>{concept.differenceFromPrevious || "첫 사건과 화자 구성을 다르게 설계"}</dd>
                    </div>
                  </dl>
                  {concept.benefitAvailability === "insufficient" ? <div className={styles.benefitWarning}>확인 가능한 혜택 정보가 부족합니다. 가격·구성·배송 정보를 추가해 주세요.</div> : null}
                  <div className={styles.conceptActions}>
                    <Link className={styles.primaryButton} href={`/video-planning/${project.id}/concept/${concept.id}`}>
                      자세히 보기
                    </Link>
                    <button className={styles.secondaryButton} disabled={busy || selected} onClick={() => selectConcept(concept.id)}>
                      {selected ? "선택 완료" : "이 콘셉트 선택"}
                    </button>
                  </div>
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

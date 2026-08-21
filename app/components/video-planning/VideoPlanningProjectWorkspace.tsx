"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  type VideoProject,
} from "../../lib/video-collaboration/types";
import { VIDEO_HOOK_LABELS, VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
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
      if (!response.ok) throw new Error(payload.error || "영상 기획 생성에 실패했습니다.");
      setProject(payload.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.empty}>영상 기획을 불러오는 중입니다.</div></main>;
  if (!project) return <main className={styles.page}><div className={styles.error}>{error || "프로젝트를 찾지 못했습니다."}</div></main>;

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href="/video-planning">← 영상 기획 목록</Link>
          <p className={styles.eyebrow}>VIDEO PLAN</p>
          <h1>{project.projectName}</h1>
          <p>{project.productAnalysis.productName} · {project.duration}초 · 자막과 장면안</p>
        </div>
        <div className={styles.topActions}>
          <span className={styles.status}>{VIDEO_STATUS_LABELS[project.status]}</span>
          <Link className={styles.primaryButton} href="/video-planning/new">새 영상 기획</Link>
        </div>
      </header>

      {error ? <div className={styles.error}><strong>영상 기획을 만들지 못했습니다.</strong>{error}<div className={styles.errorActions}><button className={styles.secondaryButton} disabled={busy} onClick={generate}>다시 시도</button></div></div> : null}

      <section className={styles.productSummaryBar}>
        <div><span>상품</span><strong>{project.productAnalysis.productName}</strong><small>{project.advertiserName}</small></div>
        <div className={styles.productFactChips}>{[...project.productAnalysis.coreUsps, ...project.productAnalysis.keyFeatures].slice(0, 4).map((fact) => <span key={fact}>{fact}</span>)}</div>
        <a className={styles.ghostButton} href={project.productUrl} rel="noreferrer" target="_blank">상세페이지 보기</a>
      </section>

      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div><h2>{project.concepts.length > 1 ? "기존 기획안" : "선택한 영상 콘셉트"}</h2><p>결과 화면에는 제작에 필요한 자막과 영상 장면 설명만 표시합니다.</p></div>
          {!project.concepts.length ? <button className={styles.primaryButton} disabled={busy} onClick={generate}>{busy ? "기획 생성 중…" : "자막·장면안 생성"}</button> : null}
        </div>
        {project.concepts.length ? (
          <div className={project.concepts.length === 1 ? styles.singleConceptGrid : styles.conceptGrid}>
            {project.concepts.map((concept) => {
              const format = VIDEO_CONCEPT_FORMAT_OPTIONS.find((option) => option.id === concept.conceptFormat);
              return (
                <article className={styles.conceptCard} key={concept.id}>
                  <span className={styles.status}>{format?.title || VIDEO_HOOK_LABELS[concept.hookType]}</span>
                  <h3>{concept.title}</h3>
                  <Link className={styles.primaryButton} href={`/video-planning/${project.id}/concept/${concept.id}`}>자막·장면안 열기</Link>
                </article>
              );
            })}
          </div>
        ) : <div className={styles.empty}>아직 생성된 영상 기획이 없습니다.</div>}
      </section>
    </main>
  );
}

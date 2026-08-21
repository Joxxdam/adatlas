"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  type VideoProjectSummary,
} from "../../lib/video-collaboration/types";
import { VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoPlanning.module.css";

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

export function VideoPlanningList() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/video-projects", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "영상 기획 목록을 불러오지 못했습니다.");
        setProjects(payload.projects || []);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "목록 조회 실패"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>VIDEO PLANNING</p>
          <h1>영상 기획</h1>
          <p>원하는 영상 콘셉트를 먼저 선택하고, 실제 제작에 필요한 자막과 장면 설명을 만듭니다.</p>
        </div>
        <Link className={styles.primaryButton} href="/video-planning/new">새 영상 기획</Link>
      </header>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><h2>최근 기획</h2><p>상품과 선택한 콘셉트를 기준으로 이어서 작업할 수 있습니다.</p></div></div>
        {loading ? <div className={styles.empty}>영상 기획을 불러오는 중입니다.</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {!loading && !error && !projects.length ? <div className={styles.empty}>아직 영상 기획이 없습니다. 상품을 분석하고 콘셉트를 선택해 첫 기획을 만들어 보세요.</div> : null}
        {projects.length ? (
          <div className={styles.planningProjectGrid}>
            {projects.map((project) => {
              const format = VIDEO_CONCEPT_FORMAT_OPTIONS.find((option) => option.id === project.conceptFormat);
              return (
                <Link className={styles.planningProjectCard} href={`/video-planning/${project.id}`} key={project.id}>
                  <div><span className={styles.status}>{format?.title || "기존 영상 기획"}</span><small>{date(project.updatedAt)}</small></div>
                  <strong>{project.projectName}</strong>
                  <p>{project.productName}</p>
                  <footer><span>{project.duration}초</span><span>{VIDEO_STATUS_LABELS[project.status]}</span><b>기획 열기 →</b></footer>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

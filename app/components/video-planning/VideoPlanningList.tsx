"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VideoProjectSummary } from "../../lib/video-collaboration/types";
import { VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoPlanning.module.css";

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

export function VideoPlanningList() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
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

  async function deleteProject(project: VideoProjectSummary) {
    if (
      !window.confirm(
        `“${project.productName}” 영상 기획을 삭제할까요?\n삭제한 기획과 프로젝트 전용 제작 파일은 복구할 수 없습니다.`
      )
    ) {
      return;
    }

    setDeletingId(project.id);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${project.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "영상 기획을 삭제하지 못했습니다.");
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "영상 기획 삭제 실패");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>VIDEO PLANNING</p>
          <h1>영상 기획</h1>
          <p>상품을 분석해 서로 다른 4개 콘셉트를 비교하고, 선택한 안의 자막과 장면 설명을 완성합니다.</p>
        </div>
        <Link className={styles.primaryButton} href="/video-planning/new">
          새 영상 기획
        </Link>
      </header>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>최근 기획</h2>
            <p>상품과 선택한 콘셉트를 기준으로 이어서 작업할 수 있습니다.</p>
          </div>
        </div>
        {loading ? <div className={styles.empty}>영상 기획을 불러오는 중입니다.</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {!loading && !error && !projects.length ? <div className={styles.empty}>아직 영상 기획이 없습니다. 상품을 분석하고 콘셉트를 선택해 첫 기획을 만들어 보세요.</div> : null}
        {projects.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.projectTable}>
              <thead>
                <tr>
                  <th>업체·브랜드</th>
                  <th>상품명</th>
                  <th>담당 마케터</th>
                  <th>담당 디자이너</th>
                  <th>선택 콘셉트</th>
                  <th>상태</th>
                  <th>생성일</th>
                  <th>마감일</th>
                  <th>최근 수정</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.advertiserName}</td>
                    <td>
                      <Link href={`/video-planning/${project.id}`}>{project.productName}</Link>
                    </td>
                    <td>{project.marketerName || "미지정"}</td>
                    <td>{project.designerName || "미지정"}</td>
                    <td>{project.selectedConceptTitle || "검토 중"}</td>
                    <td>
                      <span className={styles.status}>{VIDEO_STATUS_LABELS[project.status]}</span>
                    </td>
                    <td>{date(project.createdAt)}</td>
                    <td>{project.deadline || "미정"}</td>
                    <td>{date(project.updatedAt)}</td>
                    <td>
                      <button
                        className={styles.tableDeleteButton}
                        disabled={Boolean(deletingId)}
                        onClick={() => void deleteProject(project)}
                        type="button"
                      >
                        {deletingId === project.id ? "삭제 중…" : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

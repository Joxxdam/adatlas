"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VideoProjectStatus, VideoProjectSummary } from "../../lib/video-collaboration/types";
import { VIDEO_HOOK_LABELS, VIDEO_STATUS_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoCollaboration.module.css";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function VideoProjectList() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<VideoProjectStatus | "all">("all");

  useEffect(() => {
    fetch("/api/video-projects", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "프로젝트를 불러오지 못했습니다.");
        setProjects(payload.projects || []);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "목록 조회 실패"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (status !== "all" && project.status !== status) return false;
      if (!keyword) return true;
      return [
        project.projectName,
        project.advertiserName,
        project.productName,
        project.designerName,
        project.materialCode,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [projects, query, status]);

  const grouped = useMemo(
    () => [
      {
        key: "in-progress",
        title: "진행 중",
        description: "대본 검토부터 영상 제작 중인 프로젝트",
        projects: filtered.filter((project) =>
          ["script_pending", "script_review", "production_requested", "in_production"].includes(
            project.status
          )
        ),
      },
      {
        key: "marketer-review",
        title: "마케터 검수",
        description: "업로드된 영상의 승인 또는 피드백이 필요한 프로젝트",
        projects: filtered.filter((project) => project.status === "marketer_review"),
      },
      {
        key: "revision",
        title: "수정 요청",
        description: "디자이너가 수정본을 업로드해야 하는 프로젝트",
        projects: filtered.filter((project) => project.status === "revision_requested"),
      },
      {
        key: "archive",
        title: "완료 및 보관",
        description: "최종 승인 후 대본·영상·피드백이 계속 보존되는 프로젝트",
        projects: filtered.filter((project) => project.status === "approved"),
      },
    ],
    [filtered]
  );

  async function deleteProject(project: VideoProjectSummary) {
    if (
      !window.confirm(
        `“${project.projectName}” 프로젝트와 저장된 대본 기록을 목록에서 삭제할까요? 업로드 파일은 안전을 위해 서버에 남습니다.`
      )
    )
      return;
    try {
      const response = await fetch(`/api/video-projects/${project.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "프로젝트 삭제 실패");
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트 삭제 실패");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>VIDEO PRODUCTION WORKSPACE</p>
          <h1>영상 제작 협업</h1>
          <p>
            상품 분석과 후킹 대본부터 디자이너 제작, 마케터 검수, 최종 승인까지 한곳에서 연결합니다.
          </p>
        </div>
        <Link className={styles.primaryButton} href="/video-collaboration/new">
          새 영상 기획 만들기
        </Link>
      </header>

      <section className={styles.summaryGrid} aria-label="프로젝트 요약">
        <article>
          <strong>{projects.length}</strong>
          <span>전체 프로젝트</span>
        </article>
        <article>
          <strong>{projects.filter((item) => item.status === "marketer_review").length}</strong>
          <span>검수 대기</span>
        </article>
        <article>
          <strong>{projects.filter((item) => item.status === "revision_requested").length}</strong>
          <span>수정 요청</span>
        </article>
        <article>
          <strong>{projects.filter((item) => item.status === "approved").length}</strong>
          <span>최종 승인</span>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>프로젝트 목록</h2>
            <p>최근 수정일이 빠른 프로젝트부터 표시됩니다.</p>
          </div>
          <div className={styles.filters}>
            <select
              aria-label="상태 필터"
              onChange={(event) => setStatus(event.target.value as VideoProjectStatus | "all")}
              value={status}
            >
              <option value="all">전체 상태</option>
              {Object.entries(VIDEO_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label="프로젝트 검색"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="업체명 또는 상품명 검색"
              value={query}
            />
          </div>
        </div>
        {loading ? <div className={styles.empty}>프로젝트를 불러오는 중입니다.</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {!loading && !error && filtered.length === 0 ? (
          <div className={styles.empty}>
            <strong>조건에 맞는 영상 프로젝트가 없습니다.</strong>
            <span>새 프로젝트를 만들거나 검색 조건을 바꿔보세요.</span>
            <Link className={styles.primaryButton} href="/video-collaboration/new">
              첫 영상 기획 만들기
            </Link>
          </div>
        ) : null}
        <div className={styles.projectSections}>
          {grouped.map((group) =>
            group.projects.length ? (
              <section className={styles.projectSection} key={group.key}>
                <div className={styles.projectSectionHeader}>
                  <div>
                    <h3>{group.title}</h3>
                    <p>{group.description}</p>
                  </div>
                  <strong>{group.projects.length}</strong>
                </div>
                <div className={styles.projectGrid}>
                  {group.projects.map((project) => (
                    <article className={styles.projectCard} key={project.id}>
                      <Link
                        className={styles.projectCardLink}
                        href={`/video-collaboration/${project.id}`}
                      >
                        <div className={styles.cardTop}>
                          <span className={styles.status} data-status={project.status}>
                            {VIDEO_STATUS_LABELS[project.status]}
                          </span>
                          <small>{formatDate(project.updatedAt)}</small>
                        </div>
                        <h3>{project.projectName}</h3>
                        <p>
                          {project.advertiserName} · {project.productName}
                        </p>
                        <dl>
                          <div>
                            <dt>담당</dt>
                            <dd>
                              {project.marketerName} · {project.designerName}
                            </dd>
                          </div>
                          <div>
                            <dt>후킹</dt>
                            <dd>
                              {project.hookType
                                ? VIDEO_HOOK_LABELS[project.hookType]
                                : "대본 생성 전"}
                            </dd>
                          </div>
                          <div>
                            <dt>마감</dt>
                            <dd>{project.deadline || "미정"}</dd>
                          </div>
                        </dl>
                        <code>{project.materialCode || "소재코드 생성 전"}</code>
                      </Link>
                      <div className={styles.projectActions}>
                        <Link href={`/video-collaboration/${project.id}`}>프로젝트 상세</Link>
                        {project.materialCode ? (
                          <Link
                            className={styles.scriptLink}
                            href={`/video-collaboration/${project.id}/script`}
                          >
                            제작 대본 보기
                          </Link>
                        ) : null}
                        <button onClick={() => deleteProject(project)}>삭제</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null
          )}
        </div>
      </section>
      <aside className={styles.localNotice}>
        현재는 개발용 로컬 저장 모드입니다. JSON과 업로드 파일은 이 실행 환경에 저장되며, 서버리스
        운영 환경의 영구 저장을 보장하지 않습니다.
      </aside>
    </main>
  );
}

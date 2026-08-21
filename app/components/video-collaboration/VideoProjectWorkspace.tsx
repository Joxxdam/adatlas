"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  ReviewComment,
  VideoConcept,
  VideoCut,
  VideoProject,
  VideoVersion,
} from "../../lib/video-collaboration/types";
import {
  VIDEO_FORMAT_LABELS,
  VIDEO_HOOK_LABELS,
  VIDEO_OBJECTIVE_LABELS,
  VIDEO_STATUS_LABELS,
} from "../../lib/video-collaboration/workflow";
import styles from "./VideoCollaboration.module.css";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fileSize(value: number) {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)}MB`
    : `${Math.ceil(value / 1024)}KB`;
}

function timecode(value?: number) {
  if (value === undefined) return "전체";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function conceptClipboard(concept: VideoConcept) {
  return [
    `[${concept.materialCode}] ${concept.title}`,
    `후킹 유형: ${VIDEO_HOOK_LABELS[concept.hookType]}`,
    `핵심 타깃: ${concept.coreTarget}`,
    `첫 3초: ${concept.openingHook}`,
    `전체 대본: ${concept.fullScript}`,
    "",
    ...concept.cuts.map(
      (cut) =>
        `컷 ${cut.cutNumber} (${cut.startSecond}-${cut.endSecond}초)\n장면: ${cut.sceneDescription}\n자막: ${cut.caption}\n내레이션: ${cut.narration}\n필요 소스: ${cut.requiredSources.join(", ")}`
    ),
    "",
    `CTA: ${concept.cta}`,
    `제작 주의: ${concept.productionCautions.join(" · ")}`,
  ].join("\n");
}

function lines(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const statusStep = {
  script_pending: 1,
  script_review: 2,
  concept_selected: 2,
  production_requested: 3,
  in_production: 3,
  marketer_review: 4,
  revision_requested: 4,
  approved: 5,
} as const;

export function VideoProjectWorkspace({
  projectId,
  basePath = "/video-collaboration",
}: {
  projectId: string;
  basePath?: "/video-collaboration" | "/video-planning";
}) {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<VideoConcept | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedBy, setUploadedBy] = useState("");
  const [activeVersionId, setActiveVersionId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("마케터");
  const [commentTime, setCommentTime] = useState("");
  const [requestRevision, setRequestRevision] = useState(false);
  const [approvalVersion, setApprovalVersion] = useState<VideoVersion | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/video-projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "프로젝트를 불러오지 못했습니다.");
        if (!active) return;
        setProject(payload.project);
        setDeadline(payload.project.deadline || "");
        setUploadedBy(payload.project.designerName || "");
        setActiveVersionId(
          payload.project.approvedVersionId || payload.project.versions.at(-1)?.id || ""
        );
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "프로젝트 조회 실패");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const activeVersion = useMemo(
    () =>
      project?.versions.find((version) => version.id === activeVersionId) ||
      project?.versions.at(-1) ||
      null,
    [project, activeVersionId]
  );
  const activeComments = useMemo(
    () => project?.comments.filter((comment) => comment.versionId === activeVersion?.id) || [],
    [project, activeVersion]
  );

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setBusy(String(body.action || "save"));
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      setProject(payload.project);
      setNotice(successMessage);
      setDirty(false);
      return payload.project as VideoProject;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청 처리 실패");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function generate(conceptId?: string) {
    setBusy(conceptId ? `regenerate-${conceptId}` : "generate-all");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conceptId, actor: "마케터" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "기획안 생성에 실패했습니다.");
      setProject(payload.project);
      setEditing(null);
      setNotice(
        conceptId
          ? "선택한 후킹 기획안을 다시 생성했습니다."
          : "서로 다른 후킹 기획안 3개를 생성했습니다."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기획안 생성 실패");
    } finally {
      setBusy("");
    }
  }

  async function saveConcept() {
    if (!editing) return;
    const updated = await patch(
      { action: "update-concept", conceptId: editing.id, concept: editing, actor: "마케터" },
      "기획안 수정 내용을 저장했습니다."
    );
    if (updated) setEditing(null);
  }

  function updateCut(cutId: string, changes: Partial<VideoCut>) {
    setEditing((current) =>
      current
        ? {
            ...current,
            cuts: current.cuts.map((cut) => (cut.id === cutId ? { ...cut, ...changes } : cut)),
          }
        : current
    );
    setDirty(true);
  }

  function uploadVideo() {
    if (!uploadFile || !project) return;
    const allowed = ["video/mp4", "video/quicktime", "video/webm"];
    if (!allowed.includes(uploadFile.type)) {
      setError("MP4, MOV, WEBM 영상만 업로드할 수 있습니다.");
      return;
    }
    if (uploadFile.size > 200 * 1024 * 1024) {
      setError("영상 파일은 200MB 이하만 업로드할 수 있습니다.");
      return;
    }
    setBusy("upload");
    setError("");
    setUploadProgress(1);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/video-projects/${projectId}/versions`);
    xhr.upload.onprogress = (event) =>
      event.lengthComputable && setUploadProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(payload.error || "영상 업로드 실패");
      } else {
        setProject(payload.project);
        setActiveVersionId(payload.version.id);
        setUploadFile(null);
        setNotice(`영상 v${payload.version.versionNumber} 업로드를 완료했습니다.`);
      }
      setBusy("");
      setUploadProgress(0);
    };
    xhr.onerror = () => {
      setError("영상 업로드 중 연결이 끊겼습니다.");
      setBusy("");
      setUploadProgress(0);
    };
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("uploadedBy", uploadedBy || project.designerName);
    xhr.send(form);
  }

  async function addComment() {
    if (!activeVersion) return;
    setBusy("comment");
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: activeVersion.id,
          body: commentBody,
          author: commentAuthor,
          timecodeSeconds: commentTime === "" ? null : Number(commentTime),
          requestRevision,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "피드백 저장 실패");
      setProject(payload.project);
      setCommentBody("");
      setCommentTime("");
      setRequestRevision(false);
      setNotice(
        requestRevision
          ? "피드백을 저장하고 수정 요청 상태로 변경했습니다."
          : "피드백을 저장했습니다."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "피드백 저장 실패");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>영상 프로젝트를 불러오는 중입니다.</div>
      </main>
    );
  }
  if (!project) {
    return (
      <main className={styles.page}>
        <div className={styles.error}>{error || "프로젝트를 찾지 못했습니다."}</div>
        <Link className={styles.primaryButton} href={basePath}>
          목록으로 돌아가기
        </Link>
      </main>
    );
  }

  const currentStep = statusStep[project.status];
  const canUpload = ["in_production", "revision_requested"].includes(project.status);
  const scriptHref = basePath === "/video-planning" && project.selectedConceptId
    ? `/video-planning/${project.id}/concept/${project.selectedConceptId}`
    : `${basePath}/${project.id}${basePath === "/video-collaboration" ? "/script" : ""}`;

  return (
    <main className={styles.page}>
      <header className={styles.compactHero}>
        <div>
          <Link href={basePath}>← 프로젝트 목록</Link>
          <p className={styles.eyebrow}>VIDEO PROJECT</p>
          <h1>{project.projectName}</h1>
          <p>
            {project.advertiserName} · {project.productAnalysis.productName} · 담당{" "}
            {project.designerName}
          </p>
        </div>
        <div className={styles.headerActions}>
          {project.concepts.length ? (
            <Link
              className={styles.primaryButton}
              href={scriptHref}
            >
              제작 대본 보기
            </Link>
          ) : null}
          <span className={styles.status} data-status={project.status}>
            {VIDEO_STATUS_LABELS[project.status]}
          </span>
        </div>
      </header>

      <ol className={styles.workflowSteps}>
        {["상품 분석", "대본 검토", "영상 제작", "마케터 검수", "최종 승인"].map((label, index) => (
          <li
            data-active={currentStep >= index + 1}
            data-current={currentStep === index + 1}
            key={label}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className={styles.nextAction}>
        <strong>현재 단계</strong>
        <span>{VIDEO_STATUS_LABELS[project.status]}</span>
        <p>
          {project.status === "script_review"
            ? "후킹 기획안을 비교하고 하나를 확정해 제작 요청하세요."
            : project.status === "marketer_review"
              ? "최신 영상을 검수하고 피드백 또는 최종 승인을 선택하세요."
              : project.status === "revision_requested"
                ? "수정본을 새 버전으로 업로드하세요."
                : project.status === "approved"
                  ? "최종 승인 버전과 권장 파일명을 확인하세요."
                  : "현재 단계에서 표시된 주요 작업을 완료하세요."}
        </p>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? (
        <div className={styles.success} role="status">
          {notice}
        </div>
      ) : null}

      <section className={styles.infoStrip}>
        <div>
          <span>영상 규격</span>
          <strong>
            {project.duration}초 · {VIDEO_FORMAT_LABELS[project.format]}
          </strong>
        </div>
        <div>
          <span>목적</span>
          <strong>{VIDEO_OBJECTIVE_LABELS[project.objective]}</strong>
        </div>
        <div>
          <span>상품 URL</span>
          <a href={project.productUrl} rel="noreferrer" target="_blank">
            상세페이지 열기 ↗
          </a>
        </div>
        <div>
          <span>최근 수정</span>
          <strong>{formatDate(project.updatedAt)}</strong>
        </div>
      </section>

      <details className={styles.panel}>
        <summary>상품 분석·업체 참고정보 보기</summary>
        <div className={styles.factGrid}>
          <div>
            <span>핵심 USP</span>
            <p>{project.productAnalysis.coreUsps.join(" · ") || "직접 입력 필요"}</p>
          </div>
          <div>
            <span>타깃</span>
            <p>{project.productAnalysis.targetCustomers.join(" · ") || "직접 입력 필요"}</p>
          </div>
          <div>
            <span>고객 문제</span>
            <p>{project.productAnalysis.customerProblems.join(" · ") || "직접 입력 필요"}</p>
          </div>
          <div>
            <span>후기·신뢰</span>
            <p>{project.productAnalysis.trustSignals.join(" · ") || "공개 확인 정보 없음"}</p>
          </div>
          <div>
            <span>필수 문구</span>
            <p>{project.brandGuideline.requiredPhrases.join(" · ") || "없음"}</p>
          </div>
          <div>
            <span>금지 문구</span>
            <p>{project.brandGuideline.forbiddenPhrases.join(" · ") || "없음"}</p>
          </div>
          <div>
            <span>확인된 사실</span>
            <p>
              {project.productAnalysis.verifiedFacts
                ?.map((fact) => `${fact.label}: ${fact.value}`)
                .join(" · ") || "상세페이지에서 구조화된 사실을 추가 확인해야 합니다."}
            </p>
          </div>
          <div>
            <span>시스템 추천 해석</span>
            <p>
              {project.productAnalysis.inferredAngles?.map((fact) => fact.value).join(" · ") ||
                "없음"}
            </p>
          </div>
          <div>
            <span>사용 금지·확인 필요</span>
            <p>
              {project.productAnalysis.unsupportedClaims?.map((fact) => fact.value).join(" · ") ||
                project.productAnalysis.cautionPhrases.join(" · ") ||
                "없음"}
            </p>
          </div>
          <div>
            <span>상품 원본 고정</span>
            <p>
              {project.productLockedAsset
                ? `${project.productLockedAsset.originalFileName} · 형태·비율·뚜껑·로고·라벨·색상 유지`
                : "원본 상품 이미지가 없어 제품 합성 전 추가 업로드가 필요합니다."}
            </p>
          </div>
        </div>
      </details>

      {project.pipelineProgress?.length ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>기획 생성 진행 결과</h2>
              <p>상품 분석부터 최종 검증까지 각 단계의 구조화 결과를 저장했습니다.</p>
            </div>
          </div>
          <div className={styles.factGrid}>
            {project.pipelineProgress.map((item, index) => (
              <div key={item.stage}>
                <span>{String(index + 1).padStart(2, "0")} · {item.stage}</span>
                <p>{item.status === "warning" ? "확인 필요" : "완료"} · {item.message}</p>
              </div>
            ))}
          </div>
          <details className={styles.conceptDetail}>
            <summary>내부 후킹 후보와 평가 점수 보기</summary>
            {(project.hookCandidates || []).map((candidate) => (
              <div className={styles.cutPreview} key={candidate.id}>
                <strong>{VIDEO_HOOK_LABELS[candidate.hookType]} · {candidate.score.total}점</strong>
                <span>{candidate.hook}</span>
                <small>근거 {candidate.evidenceIds.length}개 · {candidate.visualIdea}</small>
              </div>
            ))}
          </details>
        </section>
      ) : null}

      {project.referenceAnalyses?.length ? (
        <details className={styles.panel}>
          <summary>참고 자료 분석 범위</summary>
          {project.referenceAnalyses.map((analysis) => (
            <div className={styles.cutPreview} key={analysis.assetId}>
              <strong>{analysis.assetName} · {analysis.analysisStatus === "limited" ? "제한 분석" : "정지 이미지"}</strong>
              <span>오프닝: {analysis.openingHookMethod} · 자막: {analysis.subtitlePosition}</span>
              <small>{analysis.limitations.join(" · ")}</small>
            </div>
          ))}
        </details>
      ) : null}

      {project.status === "script_pending" ? (
        <section className={styles.panel}>
          <div className={styles.empty}>
            <strong>아직 영상 대본이 없습니다.</strong>
            <span>상품 근거를 사용해 서로 다른 후킹 전략 3개를 생성합니다.</span>
            <button
              className={styles.primaryButton}
              disabled={Boolean(busy)}
              onClick={() => generate()}
            >
              {busy ? "대본 생성 중…" : "후킹 대본 3개 생성"}
            </button>
          </div>
        </section>
      ) : null}

      {project.concepts.length ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>후킹별 영상 기획안</h2>
              <p>서로 다른 고객 심리와 메시지 가설을 비교합니다.</p>
            </div>
            {project.status === "script_review" ? (
              <button
                className={styles.secondaryButton}
                disabled={Boolean(busy)}
                onClick={() => generate()}
              >
                모든 기획안 다시 생성
              </button>
            ) : null}
          </div>
          <div className={styles.conceptGrid}>
            {project.concepts.map((concept) => (
              <article
                className={styles.conceptCard}
                data-selected={project.selectedConceptId === concept.id}
                key={concept.id}
              >
                <div className={styles.cardTop}>
                  <span className={styles.hookBadge}>{VIDEO_HOOK_LABELS[concept.hookType]}</span>
                  <small>
                    rev.{concept.revision} ·{" "}
                    {concept.generationSource === "openai" ? "AI" : "근거 기반"}
                  </small>
                </div>
                <h3>{concept.title}</h3>
                <blockquote>{concept.openingHook}</blockquote>
                <dl>
                  <div>
                    <dt>타깃</dt>
                    <dd>{concept.coreTarget}</dd>
                  </div>
                  <div>
                    <dt>컷</dt>
                    <dd>
                      {concept.cuts.length}개 · {project.duration}초
                    </dd>
                  </div>
                  <div>
                    <dt>기획 점수</dt>
                    <dd>{concept.score?.total ?? "검증 전"}</dd>
                  </div>
                  <div>
                    <dt>스타일</dt>
                    <dd>{concept.visualBible?.visualMode || concept.creativeStyle || "자동"}</dd>
                  </div>
                </dl>
                <p>{concept.narrativeSummary}</p>
                <small>{concept.recommendationReason}</small>
                {concept.validation ? (
                  <small className={concept.validation.valid ? undefined : styles.warning}>
                    자동 검증 {concept.validation.score}점 · {concept.validation.valid ? "통과" : "확인 필요"}
                  </small>
                ) : null}
                <code>{concept.materialCode}</code>
                {concept.generationWarnings.map((warning) => (
                  <small className={styles.warning} key={warning}>
                    {warning}
                  </small>
                ))}
                <div className={styles.cardActions}>
                  <button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(conceptClipboard(concept))
                        .then(() => setNotice("기획안을 클립보드에 복사했습니다."))
                    }
                  >
                    복사
                  </button>
                  {project.status === "script_review" ? (
                    <button
                      onClick={() => {
                        setEditing(structuredClone(concept));
                        setDirty(false);
                      }}
                    >
                      수정
                    </button>
                  ) : null}
                  {project.status === "script_review" ? (
                    <button disabled={Boolean(busy)} onClick={() => generate(concept.id)}>
                      다시 생성
                    </button>
                  ) : null}
                  {project.status === "script_review" ? (
                    <button
                      className={styles.selectButton}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        patch(
                          { action: "select-concept", conceptId: concept.id },
                          "제작 요청할 기획안을 선택했습니다."
                        )
                      }
                    >
                      {project.selectedConceptId === concept.id ? "선택됨" : "이 기획안 선택"}
                    </button>
                  ) : null}
                </div>
                <details className={styles.conceptDetail}>
                  <summary>전체 대본·컷 구성 보기</summary>
                  <p>{concept.fullScript}</p>
                  {concept.cuts.map((cut) => (
                    <div className={styles.cutPreview} key={cut.id}>
                      <strong>
                        컷 {cut.cutNumber} · {cut.startSecond}-{cut.endSecond}초
                      </strong>
                      <span>{cut.sceneDescription}</span>
                      <b>자막 · {cut.caption}</b>
                      <small>내레이션 · {cut.narration}</small>
                    </div>
                  ))}
                </details>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <section className={styles.editorPanel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{VIDEO_HOOK_LABELS[editing.hookType]} 기획안 수정</h2>
              <p>저장 전까지 기존 대본은 유지됩니다.</p>
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setEditing(null);
                setDirty(false);
              }}
            >
              닫기
            </button>
          </div>
          <div className={styles.formGrid}>
            <label>
              기획안 제목
              <input
                value={editing.title}
                onChange={(event) => {
                  setEditing({ ...editing, title: event.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              소재코드
              <input
                value={editing.materialCode}
                onChange={(event) => {
                  setEditing({ ...editing, materialCode: event.target.value.toUpperCase() });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              핵심 타깃
              <input
                value={editing.coreTarget}
                onChange={(event) => {
                  setEditing({ ...editing, coreTarget: event.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              마지막 CTA
              <input
                value={editing.cta}
                onChange={(event) => {
                  setEditing({ ...editing, cta: event.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label className={styles.wide}>
              첫 3초 후킹
              <textarea
                value={editing.openingHook}
                onChange={(event) => {
                  setEditing({ ...editing, openingHook: event.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label className={styles.wide}>
              전체 대본
              <textarea
                value={editing.fullScript}
                onChange={(event) => {
                  setEditing({ ...editing, fullScript: event.target.value });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              필요 소스
              <textarea
                value={editing.requiredSources.join("\n")}
                onChange={(event) => {
                  setEditing({ ...editing, requiredSources: lines(event.target.value) });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              제작 주의사항
              <textarea
                value={editing.productionCautions.join("\n")}
                onChange={(event) => {
                  setEditing({ ...editing, productionCautions: lines(event.target.value) });
                  setDirty(true);
                }}
              />
            </label>
          </div>
          <div className={styles.cutEditorList}>
            {editing.cuts.map((cut) => (
              <article key={cut.id}>
                <div className={styles.cutEditorHead}>
                  <strong>컷 {cut.cutNumber}</strong>
                  <label>
                    시작
                    <input
                      min={0}
                      max={project.duration}
                      type="number"
                      value={cut.startSecond}
                      onChange={(event) =>
                        updateCut(cut.id, { startSecond: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    종료
                    <input
                      min={0}
                      max={project.duration}
                      type="number"
                      value={cut.endSecond}
                      onChange={(event) =>
                        updateCut(cut.id, { endSecond: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <label>
                  장면 설명
                  <textarea
                    value={cut.sceneDescription}
                    onChange={(event) =>
                      updateCut(cut.id, { sceneDescription: event.target.value })
                    }
                  />
                </label>
                <label>
                  화면 자막
                  <textarea
                    value={cut.caption}
                    onChange={(event) => updateCut(cut.id, { caption: event.target.value })}
                  />
                </label>
                <label>
                  내레이션
                  <textarea
                    value={cut.narration}
                    onChange={(event) => updateCut(cut.id, { narration: event.target.value })}
                  />
                </label>
                <label>
                  필요 소스
                  <textarea
                    value={cut.requiredSources.join("\n")}
                    onChange={(event) =>
                      updateCut(cut.id, { requiredSources: lines(event.target.value) })
                    }
                  />
                </label>
              </article>
            ))}
          </div>
          <div className={styles.formActions}>
            <button
              className={styles.primaryButton}
              disabled={!dirty || Boolean(busy)}
              onClick={saveConcept}
            >
              수정 내용 저장
            </button>
          </div>
        </section>
      ) : null}

      {project.status === "script_review" && project.selectedConceptId ? (
        <section className={styles.calloutPanel}>
          <div>
            <p className={styles.eyebrow}>NEXT ACTION</p>
            <h2>선택한 대본을 확정하고 제작 요청</h2>
            <p>마감일과 요청 메모를 저장하면 이후 대본은 제작 기준본으로 보존됩니다.</p>
          </div>
          <label>
            제작 마감일
            <input
              min={new Date().toISOString().slice(0, 10)}
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          </label>
          <label>
            요청 메모
            <textarea
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={!deadline || Boolean(busy)}
            onClick={() =>
              patch(
                {
                  action: "request-production",
                  conceptId: project.selectedConceptId,
                  deadline,
                  requestNote,
                  actor: "마케터",
                },
                "대본을 확정하고 디자이너 제작 요청을 등록했습니다."
              )
            }
          >
            대본 확정 및 제작 요청
          </button>
        </section>
      ) : null}

      {project.finalScript && project.status !== "script_review" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>디자이너 제작 요청서</h2>
              <p>확정 대본과 제작 조건을 한 화면에서 확인합니다.</p>
            </div>
            <div className={styles.headerActions}>
              <Link
                className={styles.primaryButton}
                href={scriptHref}
              >
                제작 대본 보기
              </Link>
              <code>{project.finalScript.materialCode}</code>
            </div>
          </div>
          <div className={styles.briefGrid}>
            <div>
              <span>업체·상품</span>
              <strong>
                {project.advertiserName} · {project.productAnalysis.productName}
              </strong>
            </div>
            <div>
              <span>후킹 전략</span>
              <strong>{VIDEO_HOOK_LABELS[project.finalScript.hookType]}</strong>
            </div>
            <div>
              <span>규격</span>
              <strong>
                {project.duration}초 · {VIDEO_FORMAT_LABELS[project.format]}
              </strong>
            </div>
            <div>
              <span>담당·마감</span>
              <strong>
                {project.designerName} · {project.deadline || "미정"}
              </strong>
            </div>
          </div>
          <details className={styles.conceptDetail}>
            <summary>확정 대본과 컷별 지시사항</summary>
            <p>{project.finalScript.fullScript}</p>
            {project.finalScript.cuts.map((cut) => (
              <div className={styles.cutPreview} key={cut.id}>
                <strong>
                  컷 {cut.cutNumber} · {cut.startSecond}-{cut.endSecond}초
                </strong>
                <span>{cut.sceneDescription}</span>
                <b>{cut.caption}</b>
                <small>{cut.narration}</small>
              </div>
            ))}
          </details>
          {project.status === "production_requested" ? (
            <div className={styles.formActions}>
              <button
                className={styles.primaryButton}
                disabled={Boolean(busy)}
                onClick={() =>
                  patch(
                    { action: "start-production", actor: project.designerName },
                    "영상 제작 중 상태로 변경했습니다."
                  )
                }
              >
                디자이너 작업 시작
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canUpload ? (
        <section className={styles.calloutPanel}>
          <div>
            <p className={styles.eyebrow}>
              {project.status === "revision_requested" ? "UPLOAD REVISION" : "UPLOAD VIDEO"}
            </p>
            <h2>
              {project.status === "revision_requested"
                ? `수정본 v${project.versions.length + 1} 업로드`
                : "완성 영상 업로드"}
            </h2>
            <p>MP4·MOV·WEBM, 최대 200MB. 업로드 시 버전 번호가 자동 증가합니다.</p>
          </div>
          <label>
            업로드 담당자
            <input value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} />
          </label>
          <label>
            영상 파일
            <input
              accept="video/mp4,video/quicktime,video/webm,.mov"
              type="file"
              onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
            />
            {uploadFile ? (
              <small>
                {uploadFile.name} · {fileSize(uploadFile.size)}
              </small>
            ) : null}
          </label>
          {uploadProgress ? <progress max={100} value={uploadProgress} /> : null}
          <button
            className={styles.primaryButton}
            disabled={!uploadFile || Boolean(busy)}
            onClick={uploadVideo}
          >
            {busy === "upload"
              ? `업로드 ${uploadProgress}%`
              : `v${project.versions.length + 1} 업로드`}
          </button>
        </section>
      ) : null}

      {project.versions.length ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>영상 버전과 검수</h2>
              <p>과거 버전과 피드백은 삭제하지 않고 유지합니다.</p>
            </div>
            <div className={styles.versionTabs}>
              {project.versions.map((version) => (
                <button
                  data-active={activeVersion?.id === version.id}
                  key={version.id}
                  onClick={() => setActiveVersionId(version.id)}
                >
                  v{version.versionNumber}
                </button>
              ))}
            </div>
          </div>
          {activeVersion ? (
            <div className={styles.reviewLayout}>
              <div className={styles.videoPanel}>
                <video
                  controls
                  key={activeVersion.filePath}
                  preload="metadata"
                  src={activeVersion.filePath}
                >
                  이 브라우저는 영상 미리보기를 지원하지 않습니다.
                </video>
                <div>
                  <strong>
                    v{activeVersion.versionNumber} · {activeVersion.originalFileName}
                  </strong>
                  <span>
                    {activeVersion.uploadedBy} · {formatDate(activeVersion.uploadedAt)} ·{" "}
                    {fileSize(activeVersion.size)}
                  </span>
                  <a download={activeVersion.storedFileName} href={activeVersion.filePath}>
                    권장 파일명으로 다운로드
                  </a>
                </div>
              </div>
              <div className={styles.feedbackPanel}>
                <h3>피드백 체크리스트</h3>
                {activeComments.length ? (
                  activeComments.map((comment: ReviewComment) => (
                    <article data-resolved={comment.resolved} key={comment.id}>
                      <div>
                        <strong>{timecode(comment.timecodeSeconds)}</strong>
                        <span>
                          {comment.author} · {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      <p>{comment.body}</p>
                      {!comment.resolved ? (
                        <button
                          onClick={() =>
                            patch(
                              {
                                action: "resolve-comment",
                                commentId: comment.id,
                                actor: project.designerName,
                              },
                              "피드백을 해결됨으로 표시했습니다."
                            )
                          }
                        >
                          해결 완료
                        </button>
                      ) : (
                        <small>해결됨 · {comment.resolvedBy}</small>
                      )}
                    </article>
                  ))
                ) : (
                  <div className={styles.emptySmall}>이 버전에 등록된 피드백이 없습니다.</div>
                )}
                {project.status === "marketer_review" ? (
                  <div className={styles.feedbackForm}>
                    <label>
                      작성자
                      <input
                        value={commentAuthor}
                        onChange={(event) => setCommentAuthor(event.target.value)}
                      />
                    </label>
                    <label>
                      시간(초, 선택)
                      <input
                        min={0}
                        max={project.duration}
                        type="number"
                        value={commentTime}
                        onChange={(event) => setCommentTime(event.target.value)}
                      />
                    </label>
                    <label className={styles.wide}>
                      피드백
                      <textarea
                        placeholder="예: 첫 자막을 더 짧게 수정"
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                      />
                    </label>
                    <label className={styles.checkLabel}>
                      <input
                        checked={requestRevision}
                        onChange={(event) => setRequestRevision(event.target.checked)}
                        type="checkbox"
                      />{" "}
                      이 피드백과 함께 수정 요청 상태로 변경
                    </label>
                    <button disabled={!commentBody.trim() || Boolean(busy)} onClick={addComment}>
                      {requestRevision ? "피드백 저장 및 수정 요청" : "피드백 저장"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {activeVersion && project.status === "marketer_review" ? (
            <div className={styles.approveBar}>
              <div>
                <strong>이 버전으로 최종 승인할까요?</strong>
                <span>승인 후에도 과거 버전과 피드백 기록은 유지됩니다.</span>
              </div>
              <button onClick={() => setApprovalVersion(activeVersion)}>최종 승인</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {project.status === "approved" && project.approvedVersionId
        ? (() => {
            const approved = project.versions.find(
              (version) => version.id === project.approvedVersionId
            );
            return approved ? (
              <section className={styles.approvedPanel}>
                <span>✓</span>
                <div>
                  <p className={styles.eyebrow}>FINAL APPROVED</p>
                  <h2>v{approved.versionNumber} 최종 승인 완료</h2>
                  <p>권장 최종 파일명</p>
                  <code>{approved.storedFileName}</code>
                </div>
                <a download={approved.storedFileName} href={approved.filePath}>
                  최종 영상 다운로드
                </a>
              </section>
            ) : null;
          })()
        : null}

      <details className={styles.panel}>
        <summary>상태 변경 이력</summary>
        <ol className={styles.historyList}>
          {[...project.statusHistory].reverse().map((item) => (
            <li key={item.id}>
              <span>{formatDate(item.changedAt)}</span>
              <strong>
                {item.from ? `${VIDEO_STATUS_LABELS[item.from]} → ` : ""}
                {VIDEO_STATUS_LABELS[item.to]}
              </strong>
              <p>
                {item.actor} · {item.note}
              </p>
            </li>
          ))}
        </ol>
      </details>

      <aside className={styles.localNotice}>
        영상 파일은 현재 서버의 <code>public/video-collaboration/videos</code>에 저장됩니다.
        서버리스 배포나 인스턴스 교체 환경에서는 외부 오브젝트 스토리지 연결이 필요합니다.
      </aside>

      {approvalVersion ? (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            aria-labelledby="approve-title"
            aria-modal="true"
            className={styles.modal}
            role="dialog"
          >
            <p className={styles.eyebrow}>FINAL APPROVAL</p>
            <h2 id="approve-title">v{approvalVersion.versionNumber}을 최종 승인할까요?</h2>
            <p>
              최종 승인 버전은 <strong>{approvalVersion.storedFileName}</strong>으로 표시됩니다.
              기존 버전과 피드백은 유지됩니다.
            </p>
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} onClick={() => setApprovalVersion(null)}>
                취소
              </button>
              <button
                className={styles.primaryButton}
                disabled={Boolean(busy)}
                onClick={async () => {
                  const updated = await patch(
                    { action: "approve-version", versionId: approvalVersion.id, actor: "마케터" },
                    `v${approvalVersion.versionNumber}을 최종 승인했습니다.`
                  );
                  if (updated) setApprovalVersion(null);
                }}
              >
                최종 승인 확정
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

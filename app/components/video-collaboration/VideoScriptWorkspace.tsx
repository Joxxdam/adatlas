/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  getProjectScript,
  resequenceVideoCuts,
  videoScriptClipboard,
  videoScriptCsv,
} from "../../lib/video-collaboration/script";
import {
  ALLOWED_SCENE_REFERENCE_TYPES,
  MAX_SCENE_REFERENCE_BYTES,
} from "../../lib/video-collaboration/referenceImage";
import type {
  VideoConcept,
  VideoCut,
  VideoProject,
  VideoSceneReferenceImage,
} from "../../lib/video-collaboration/types";
import {
  VIDEO_FORMAT_LABELS,
  VIDEO_HOOK_LABELS,
  VIDEO_STATUS_LABELS,
} from "../../lib/video-collaboration/workflow";
import styles from "./VideoScriptWorkspace.module.css";

function formatDate(value?: string, fallback = "미정") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function compactDate(value?: string) {
  if (!value) return "미정";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

function fileSize(value: number) {
  if (!value) return "외부 URL";
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)}MB`
    : `${Math.ceil(value / 1024)}KB`;
}

function syncFullScript(concept: VideoConcept) {
  return {
    ...concept,
    openingHook: concept.cuts[0]?.caption || concept.openingHook,
    fullScript: concept.cuts
      .map((cut) => cut.narration || cut.caption)
      .filter(Boolean)
      .join(" "),
  };
}

function downloadText(name: string, value: string, type: string) {
  const blob = new Blob([`\uFEFF${value}`], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReferencePreview({
  image,
  onOpen,
}: {
  image?: VideoSceneReferenceImage;
  onOpen: (image: VideoSceneReferenceImage) => void;
}) {
  const [brokenPath, setBrokenPath] = useState("");
  const broken = Boolean(image?.filePath && brokenPath === image.filePath);
  if (!image) return <span className={styles.noReference}>참고 이미지 없음</span>;
  if (broken) {
    return (
      <div className={styles.brokenReference}>
        <strong>이미지를 불러오지 못했습니다.</strong>
        <span>{image.description || image.name}</span>
      </div>
    );
  }
  return (
    <button className={styles.referencePreview} onClick={() => onOpen(image)} type="button">
      <img
        alt={image.description || image.name}
        onError={() => setBrokenPath(image.filePath)}
        src={image.filePath}
      />
      {image.required ? <span className={styles.requiredBadge}>필수 사용</span> : null}
      <small>{image.description || image.name}</small>
    </button>
  );
}

export function VideoScriptWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [draft, setDraft] = useState<VideoConcept | null>(null);
  const [productionNotes, setProductionNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [designerView, setDesignerView] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<VideoSceneReferenceImage | null>(null);
  const [externalUrls, setExternalUrls] = useState<Record<string, string>>({});
  const [imageProgress, setImageProgress] = useState<Record<string, number>>({});
  const [deadline, setDeadline] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [selectedCutId, setSelectedCutId] = useState("");
  const draftRef = useRef<VideoConcept | null>(null);
  const productionNotesRef = useRef("");
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/video-projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "제작 대본을 불러오지 못했습니다.");
        if (!active) return;
        const nextProject = payload.project as VideoProject;
        const script = getProjectScript(nextProject);
        setProject(nextProject);
        setDraft(script ? structuredClone(script) : null);
        setSelectedCutId(script?.cuts[0]?.id || "");
        setProductionNotes(nextProject.productionNotes || "");
        setDeadline(nextProject.deadline || "");
        setLastSavedAt(nextProject.updatedAt);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "제작 대본 조회 실패");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    productionNotesRef.current = productionNotes;
  }, [productionNotes]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    const preventLinkNavigation = (event: MouseEvent) => {
      if (!dirty) return;
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a[href]");
      if (!link || window.confirm("저장되지 않은 대본 수정 내용이 있습니다. 페이지를 이동할까요?"))
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", preventLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", preventLinkNavigation, true);
    };
  }, [dirty]);

  const saveScript = useCallback(
    async (silent = false) => {
      if (!project || !draft || savingRef.current) return false;
      const snapshot = JSON.stringify({ draft, productionNotes });
      savingRef.current = true;
      setBusy("save-script");
      setSaveState("saving");
      setError("");
      try {
        const response = await fetch(`/api/video-projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "save-script",
            conceptId: draft.id,
            concept: syncFullScript(draft),
            actor: project.marketerName || "마케터",
            changes: { productionNotes },
            createRevision: !silent,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "제작 대본 저장 실패");
        const nextProject = payload.project as VideoProject;
        const currentSnapshot = JSON.stringify({
          draft: draftRef.current,
          productionNotes: productionNotesRef.current,
        });
        setProject(nextProject);
        if (snapshot === currentSnapshot) {
          const saved = getProjectScript(nextProject);
          setDraft(saved ? structuredClone(saved) : null);
          setDirty(false);
        }
        setLastSavedAt(nextProject.updatedAt);
        setSaveState("saved");
        if (!silent) setNotice("제작 대본을 복원 가능한 새 버전으로 저장했습니다.");
        return true;
      } catch (caught) {
        setSaveState("error");
        setError(caught instanceof Error ? caught.message : "제작 대본 저장 실패");
        return false;
      } finally {
        savingRef.current = false;
        setBusy("");
      }
    },
    [draft, productionNotes, project, projectId]
  );

  useEffect(() => {
    if (!editing || !dirty || busy || !draft) return;
    const timer = window.setTimeout(() => void saveScript(true), 2500);
    return () => window.clearTimeout(timer);
  }, [busy, dirty, draft, editing, productionNotes, saveScript]);

  function updateDraft(updater: (current: VideoConcept) => VideoConcept) {
    setDraft((current) => (current ? syncFullScript(updater(current)) : current));
    setDirty(true);
    setSaveState("idle");
  }

  function updateCut(cutId: string, changes: Partial<VideoCut>) {
    updateDraft((current) => ({
      ...current,
      cuts: current.cuts.map((cut) => (cut.id === cutId ? { ...cut, ...changes } : cut)),
    }));
  }

  function addScene() {
    if (!project || !draft || draft.cuts.length >= 40) return;
    const cut: VideoCut = {
      id: crypto.randomUUID(),
      cutNumber: draft.cuts.length + 1,
      sceneName: `장면 ${draft.cuts.length + 1}`,
      startSecond: 0,
      endSecond: project.duration,
      sceneDescription:
        "제작자가 바로 이해할 수 있도록 인물, 제품, 배경, 구도와 효과를 입력하세요.",
      caption: "새 장면 자막",
      narration: "",
      requiredSources: [],
      referenceImages: [],
      productionMemo: "",
      sceneFormat: "실사",
      cameraComposition: "세로 9:16 안전 영역 안에 핵심 피사체를 배치",
      motionDirection: "장면 메시지와 같은 방향의 단일 동작",
      transition: "하드컷",
      generationPrompt: "실제 제작 가능한 세로형 광고 영상 장면. 제품과 자막이 겹치지 않게 구성.",
    };
    updateDraft((current) => ({
      ...current,
      cuts: resequenceVideoCuts([...current.cuts, cut], project.duration),
    }));
    setExpanded((current) => new Set(current).add(cut.id));
  }

  function deleteScene(cut: VideoCut) {
    if (!project || !draft || draft.cuts.length <= 1) return;
    if (!window.confirm(`${cut.sceneName || `장면 ${cut.cutNumber}`}을(를) 삭제할까요?`)) return;
    updateDraft((current) => ({
      ...current,
      cuts: resequenceVideoCuts(
        current.cuts.filter((item) => item.id !== cut.id),
        project.duration
      ),
    }));
  }

  function cloneScene(cut: VideoCut) {
    if (!project || !draft || draft.cuts.length >= 40) return;
    const index = draft.cuts.findIndex((item) => item.id === cut.id);
    const copy: VideoCut = {
      ...structuredClone(cut),
      id: crypto.randomUUID(),
      sceneName: `${cut.sceneName || `장면 ${cut.cutNumber}`} 복제`,
      referenceImages: cut.referenceImages.map((image) => ({
        ...structuredClone(image),
        id: crypto.randomUUID(),
      })),
    };
    const next = [...draft.cuts];
    next.splice(index + 1, 0, copy);
    updateDraft((current) => ({ ...current, cuts: resequenceVideoCuts(next, project.duration) }));
  }

  function moveScene(cutId: string, direction: -1 | 1) {
    if (!project || !draft) return;
    const index = draft.cuts.findIndex((cut) => cut.id === cutId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.cuts.length) return;
    const next = [...draft.cuts];
    [next[index], next[target]] = [next[target], next[index]];
    updateDraft((current) => ({ ...current, cuts: resequenceVideoCuts(next, project.duration) }));
  }

  function setImageAt(cutId: string, slot: number, image: VideoSceneReferenceImage) {
    const cut = draftRef.current?.cuts.find((item) => item.id === cutId);
    const targetSlot = slot === 1 && !cut?.referenceImages[0] ? 0 : slot;
    const next = [...(cut?.referenceImages || [])];
    next[targetSlot] = image;
    updateCut(cutId, { referenceImages: next.filter(Boolean).slice(0, 2) });
  }

  function uploadSceneImage(cutId: string, slot: number, file: File) {
    if (!ALLOWED_SCENE_REFERENCE_TYPES.has(file.type)) {
      setError("JPG, JPEG, PNG, WEBP 이미지만 업로드할 수 있습니다.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_SCENE_REFERENCE_BYTES) {
      setError("장면 참고 이미지는 10MB 이하만 업로드할 수 있습니다.");
      return;
    }
    const key = `${cutId}-${slot}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/video-projects/${projectId}/scene-images`);
    setImageProgress((current) => ({ ...current, [key]: 1 }));
    xhr.upload.onprogress = (event) =>
      event.lengthComputable &&
      setImageProgress((current) => ({
        ...current,
        [key]: Math.round((event.loaded / event.total) * 100),
      }));
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(payload.error || "장면 참고 이미지 업로드 실패");
      } else {
        setImageAt(cutId, slot, payload.image);
        setNotice("참고 이미지 업로드가 완료되었습니다. 대본에 자동 저장됩니다.");
      }
      setImageProgress((current) => ({ ...current, [key]: 0 }));
    };
    xhr.onerror = () => {
      setError("장면 참고 이미지 업로드 중 연결이 끊겼습니다.");
      setImageProgress((current) => ({ ...current, [key]: 0 }));
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  }

  function addExternalImage(cutId: string, slot: number) {
    const key = `${cutId}-${slot}`;
    const value = (externalUrls[key] || "").trim();
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("외부 참고 이미지는 HTTP 또는 HTTPS URL을 입력해 주세요.");
      return;
    }
    setImageAt(cutId, slot, {
      id: crypto.randomUUID(),
      source: "external",
      filePath: value,
      name: "외부 참고 이미지",
      mimeType: "image/external",
      size: 0,
      description: "",
      required: false,
      createdAt: new Date().toISOString(),
    });
    setExternalUrls((current) => ({ ...current, [key]: "" }));
  }

  async function patchProject(body: Record<string, unknown>, message: string) {
    setBusy(String(body.action || "project-action"));
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      setProject(payload.project);
      const script = getProjectScript(payload.project);
      setDraft(script ? structuredClone(script) : null);
      setDeadline(payload.project.deadline || deadline);
      setNotice(message);
      return payload.project as VideoProject;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청 처리 실패");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function regenerate(mode: "all" | "hooks-only" | "selected-scene") {
    if (!project || !draft) return;
    if (dirty && !(await saveScript(false))) return;
    setBusy(`regenerate-${mode}`);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          conceptId: mode === "hooks-only" ? undefined : draft.id,
          cutId: mode === "selected-scene" ? selectedCutId : undefined,
          actor: project.marketerName || "마케터",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "대본 재생성 실패");
      const nextProject = payload.project as VideoProject;
      setProject(nextProject);
      const nextDraft = getProjectScript(nextProject);
      setDraft(nextDraft ? structuredClone(nextDraft) : null);
      setDirty(false);
      setNotice(
        mode === "hooks-only"
          ? "후킹 후보와 첫 장면 문구만 다시 생성했습니다."
          : mode === "selected-scene"
            ? "선택한 장면만 다시 생성했습니다."
            : "전체 기획안을 다시 생성했습니다."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "대본 재생성 실패");
    } finally {
      setBusy("");
    }
  }

  async function finalizeScript() {
    if (!project || !draft || !deadline) return;
    if (dirty && !(await saveScript(false))) return;
    await patchProject(
      {
        action: "request-production",
        conceptId: draft.id,
        deadline,
        actor: project.marketerName,
        requestNote: project.additionalRequests,
      },
      "대본을 확정하고 제작 요청 상태로 변경했습니다."
    );
  }

  function uploadVideo() {
    if (!videoFile || !project) return;
    const allowed = ["video/mp4", "video/quicktime", "video/webm"];
    if (!allowed.includes(videoFile.type) || videoFile.size > 200 * 1024 * 1024) {
      setError("MP4, MOV, WEBM 형식의 200MB 이하 영상만 업로드할 수 있습니다.");
      return;
    }
    setBusy("upload-video");
    setVideoProgress(1);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/video-projects/${projectId}/versions`);
    xhr.upload.onprogress = (event) =>
      event.lengthComputable && setVideoProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(payload.error || "영상 업로드 실패");
      } else {
        setProject(payload.project);
        setVideoFile(null);
        setNotice(`영상 v${payload.version.versionNumber} 업로드와 제작 완료 요청을 마쳤습니다.`);
      }
      setBusy("");
      setVideoProgress(0);
    };
    xhr.onerror = () => {
      setError("영상 업로드 중 연결이 끊겼습니다.");
      setBusy("");
      setVideoProgress(0);
    };
    const form = new FormData();
    form.append("file", videoFile);
    form.append("uploadedBy", project.designerName);
    xhr.send(form);
  }

  async function requestRevision() {
    const version = project?.versions.at(-1);
    if (!project || !version || !reviewComment.trim()) {
      setError("수정 요청 내용을 입력해 주세요.");
      return;
    }
    setBusy("revision-request");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: version.id,
          body: reviewComment,
          author: project.marketerName,
          requestRevision: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "수정 요청 실패");
      setProject(payload.project);
      setReviewComment("");
      setNotice("수정 요청을 저장했습니다. 제작 대본과 기존 영상 버전은 유지됩니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수정 요청 실패");
    } finally {
      setBusy("");
    }
  }

  async function duplicateApproved() {
    if (!project) return;
    const duplicate = await patchProject(
      { action: "duplicate-approved", actor: project.marketerName },
      "완료된 제작 대본을 새 프로젝트로 복제했습니다."
    );
    if (duplicate) router.push(`/video-collaboration/${duplicate.id}/script`);
  }

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  }

  if (loading) {
    return <main className={styles.loading}>제작 대본을 불러오는 중입니다.</main>;
  }
  if (!project || !draft) {
    return (
      <main className={styles.loading}>
        <p>{error || "표시할 제작 대본이 없습니다."}</p>
        <Link href={`/video-collaboration/${projectId}`}>프로젝트 상세로 돌아가기</Link>
      </main>
    );
  }

  const hasRequiredReferences = draft.cuts.some((cut) =>
    cut.referenceImages.some((image) => image.required)
  );
  const latestVersion = project.versions.at(-1);
  const approvedVersion = project.versions.find(
    (version) => version.id === project.approvedVersionId
  );

  return (
    <main className={styles.page} data-designer={designerView}>
      <nav className={styles.topNavigation}>
        <div>
          <Link href="/video-collaboration">← 프로젝트 목록</Link>
          <Link href={`/video-collaboration/${project.id}`}>프로젝트 상세</Link>
        </div>
        <div>
          <button onClick={() => setDesignerView((current) => !current)} type="button">
            {designerView ? "기본 보기" : "디자이너 보기"}
          </button>
          <button onClick={() => window.print()} type="button">
            인쇄·PDF 저장
          </button>
        </div>
      </nav>

      <header className={styles.header}>
        <div>
          <p>VIDEO PRODUCTION SCRIPT</p>
          <h1>{project.projectName}</h1>
          <span>
            {project.advertiserName} · {project.productAnalysis.productName}
          </span>
        </div>
        <div className={styles.headerStatus}>
          <span data-status={project.status}>{VIDEO_STATUS_LABELS[project.status]}</span>
          <code>{draft.materialCode}</code>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>
          {error}
          {saveState === "error" ? (
            <button onClick={() => void saveScript(false)}>다시 저장</button>
          ) : null}
        </div>
      ) : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={styles.summary} aria-label="제작 대본 요약">
        <div>
          <dt>업체명</dt>
          <dd>{project.advertiserName}</dd>
        </div>
        <div>
          <dt>상품명</dt>
          <dd>{project.productAnalysis.productName}</dd>
        </div>
        <div>
          <dt>상품 URL</dt>
          <dd>
            <a href={project.productUrl} rel="noreferrer" target="_blank">
              상세페이지 열기 ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>영상 기획명</dt>
          <dd>{draft.title}</dd>
        </div>
        <div>
          <dt>소구점·후킹</dt>
          <dd>{VIDEO_HOOK_LABELS[draft.hookType]}</dd>
        </div>
        <div>
          <dt>영상 규격</dt>
          <dd>
            {project.duration}초 · {VIDEO_FORMAT_LABELS[project.format]}
          </dd>
        </div>
        <div>
          <dt>담당 마케터</dt>
          <dd>{project.marketerName}</dd>
        </div>
        <div>
          <dt>담당 디자이너</dt>
          <dd>{project.designerName}</dd>
        </div>
        <div>
          <dt>제작 요청일</dt>
          <dd>{compactDate(project.milestones.productionRequestedAt)}</dd>
        </div>
        <div>
          <dt>마감일</dt>
          <dd>{project.deadline || "미정"}</dd>
        </div>
        <div>
          <dt>현재 진행 상태</dt>
          <dd>{VIDEO_STATUS_LABELS[project.status]}</dd>
        </div>
        <div>
          <dt>소재코드</dt>
          <dd>{draft.materialCode}</dd>
        </div>
        {approvedVersion ? (
          <div>
            <dt>승인 영상 버전</dt>
            <dd>
              v{approvedVersion.versionNumber} · {approvedVersion.originalFileName}
            </dd>
          </div>
        ) : null}
      </section>

      {project.additionalRequests ? (
        <section className={styles.requestBox}>
          <strong>추가 요청사항</strong>
          <p>{project.additionalRequests}</p>
        </section>
      ) : null}

      <section className={styles.requestBox}>
        <strong>선택 콘셉트 요약</strong>
        <p><b>후킹</b> · {draft.openingHook}</p>
        <p><b>타깃</b> · {draft.coreTarget}</p>
        <p><b>고객 문제</b> · {draft.customerProblem || project.productAnalysis.customerProblems[0] || "추가 확인 필요"}</p>
        <p><b>USP</b> · {draft.usp || project.productAnalysis.coreUsps[0] || "추가 확인 필요"}</p>
        <p><b>스타일</b> · {draft.visualBible?.visualMode || draft.creativeStyle || "AI 자동"}</p>
        <p><b>서사</b> · {draft.narrativeSummary || "문제→제품 공개→근거→CTA"}</p>
        <p><b>추천 이유</b> · {draft.recommendationReason || "상품 근거와 장면화 가능성을 기준으로 선정"}</p>
        <p><b>확인할 주장</b> · {draft.claimsToVerify?.join(" · ") || "없음"}</p>
      </section>

      {draft.visualBible ? (
        <details className={styles.requestBox}>
          <summary>비주얼 바이블·제품 원본 고정 규칙</summary>
          <p><b>세계관</b> · {draft.visualBible.backgroundWorld}</p>
          <p><b>카메라</b> · {draft.visualBible.cameraStyle}</p>
          <p><b>제품 표현</b> · {draft.visualBible.productPresentation}</p>
          <p><b>텍스트 안전 영역</b> · {draft.visualBible.textSafeArea}</p>
          <p><b>연속성</b> · {draft.visualBible.continuityRules.join(" · ")}</p>
          <p><b>금지 생성</b> · {draft.visualBible.negativePrompt.join(" · ")}</p>
          <p><b>원본 파일</b> · {project.productLockedAsset?.originalFileName || "원본 추가 업로드 필요"}</p>
        </details>
      ) : null}

      <section className={styles.actionPanel}>
        <div>
          <span>현재 상태</span>
          <strong>{VIDEO_STATUS_LABELS[project.status]}</strong>
          <p>
            마지막 저장 {formatDate(lastSavedAt)} · {project.scriptLastEditedBy}
            {saveState === "saving" ? " · 자동 저장 중…" : saveState === "saved" ? " · 저장됨" : ""}
          </p>
        </div>
        {project.status === "script_review" ? (
          <div className={styles.inlineAction}>
            <label>
              마감일
              <input
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDeadline(event.target.value)}
                type="date"
                value={deadline}
              />
            </label>
            <button disabled={!deadline || Boolean(busy)} onClick={finalizeScript}>
              대본 확정
            </button>
          </div>
        ) : null}
        {project.status === "production_requested" ? (
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              patchProject(
                { action: "start-production", actor: project.designerName },
                "영상 제작 중 상태로 변경했습니다."
              )
            }
          >
            작업 시작
          </button>
        ) : null}
        {["in_production", "revision_requested"].includes(project.status) ? (
          <div className={styles.uploadAction}>
            <label>
              영상 업로드
              <input
                accept="video/mp4,video/quicktime,video/webm,.mov"
                onChange={(event) => setVideoFile(event.target.files?.[0] || null)}
                type="file"
              />
            </label>
            {videoProgress ? <progress max={100} value={videoProgress} /> : null}
            <button disabled={!videoFile || Boolean(busy)} onClick={uploadVideo}>
              {project.status === "revision_requested" ? "수정본 업로드" : "제작 완료 요청"}
            </button>
          </div>
        ) : null}
        {project.status === "marketer_review" && latestVersion ? (
          <div className={styles.reviewAction}>
            <textarea
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder="수정 요청 내용을 입력"
              value={reviewComment}
            />
            <button disabled={Boolean(busy)} onClick={requestRevision}>
              수정 요청
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                window.confirm(`v${latestVersion.versionNumber}을 최종 승인할까요?`) &&
                patchProject(
                  {
                    action: "approve-version",
                    versionId: latestVersion.id,
                    actor: project.marketerName,
                  },
                  "최종 승인하고 완료 보관함으로 이동했습니다."
                )
              }
            >
              최종 승인
            </button>
          </div>
        ) : null}
        {project.status === "approved" ? (
          <button disabled={Boolean(busy)} onClick={duplicateApproved}>
            완료된 대본 복제
          </button>
        ) : null}
      </section>

      <section className={styles.scriptToolbar}>
        <div>
          <button
            onClick={() => copy(videoScriptClipboard(project, "all"), "전체 대본을 복사했습니다.")}
          >
            전체 대본 복사
          </button>
          <button
            onClick={() => copy(videoScriptClipboard(project, "captions"), "자막만 복사했습니다.")}
          >
            자막만 복사
          </button>
          <button
            onClick={() =>
              copy(videoScriptClipboard(project, "scenes"), "영상 장면 설명만 복사했습니다.")
            }
          >
            장면 설명만 복사
          </button>
          <button
            onClick={() =>
              downloadText(
                `${draft.materialCode}.csv`,
                videoScriptCsv({ ...project, finalScript: draft }),
                "text/csv;charset=utf-8"
              )
            }
          >
            CSV 다운로드
          </button>
          {project.status === "script_review" ? (
            <>
              <button disabled={Boolean(busy)} onClick={() => void regenerate("all")}>전체 재생성</button>
              <button disabled={Boolean(busy)} onClick={() => void regenerate("hooks-only")}>후킹만 재생성</button>
              <select aria-label="부분 재생성 장면" value={selectedCutId} onChange={(event) => setSelectedCutId(event.target.value)}>
                {draft.cuts.map((cut) => <option key={cut.id} value={cut.id}>{cut.sceneName}</option>)}
              </select>
              <button disabled={!selectedCutId || Boolean(busy)} onClick={() => void regenerate("selected-scene")}>선택 장면 재생성</button>
            </>
          ) : null}
        </div>
        <div>
          {editing ? (
            <>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  if (!dirty || window.confirm("저장하지 않은 수정을 취소할까요?")) {
                    const original = getProjectScript(project);
                    setDraft(original ? structuredClone(original) : null);
                    setProductionNotes(project.productionNotes || "");
                    setEditing(false);
                    setDirty(false);
                  }
                }}
              >
                편집 취소
              </button>
              <button disabled={!dirty || Boolean(busy)} onClick={() => void saveScript(false)}>
                {saveState === "saving" ? "저장 중…" : "새 버전 저장"}
              </button>
              <button onClick={addScene}>장면 추가</button>
            </>
          ) : project.status !== "approved" ? (
            <button onClick={() => setEditing(true)}>대본 수정</button>
          ) : null}
        </div>
      </section>

      <div className={styles.referenceNotice} data-required={hasRequiredReferences}>
        <strong>참고 이미지 안내</strong>
        <span>
          참고 이미지는 제작 방향을 설명하기 위한 자료이며, 의도와 소구점을 유지하는 범위에서 교체할
          수 있습니다.
        </span>
        {hasRequiredReferences ? (
          <b>“필수 사용” 배지가 있는 이미지는 반드시 사용해 주세요.</b>
        ) : null}
      </div>

      <section className={styles.tableSection}>
        <div className={styles.tableScroll}>
          <table className={styles.scriptTable}>
            <thead>
              <tr>
                <th>장면</th>
                <th>시간</th>
                <th>형식</th>
                <th>자막·내레이션</th>
                <th>장면 구성</th>
                <th>카메라·구도</th>
                <th>움직임·연출</th>
                <th>전환</th>
                <th>필요 소스·생성 프롬프트</th>
              </tr>
            </thead>
            <tbody>
              {draft.cuts.map((cut) => (
                <tr key={`plan-${cut.id}`}>
                  <td><strong>{cut.sceneName}</strong></td>
                  <td>{cut.startSecond}-{cut.endSecond}초</td>
                  <td>
                    {editing ? <textarea value={cut.sceneFormat || ""} onChange={(event) => updateCut(cut.id, { sceneFormat: event.target.value })} /> : cut.sceneFormat || "실사"}
                  </td>
                  <td>
                    {editing ? (
                      <>
                        <textarea value={cut.caption} onChange={(event) => updateCut(cut.id, { caption: event.target.value })} />
                        <textarea value={cut.narration} onChange={(event) => updateCut(cut.id, { narration: event.target.value })} />
                      </>
                    ) : <><b>{cut.caption}</b><p>{cut.narration}</p></>}
                  </td>
                  <td>{editing ? <textarea value={cut.sceneDescription} onChange={(event) => updateCut(cut.id, { sceneDescription: event.target.value })} /> : cut.sceneDescription}</td>
                  <td>{editing ? <textarea value={cut.cameraComposition || ""} onChange={(event) => updateCut(cut.id, { cameraComposition: event.target.value })} /> : cut.cameraComposition}</td>
                  <td>{editing ? <textarea value={cut.motionDirection || ""} onChange={(event) => updateCut(cut.id, { motionDirection: event.target.value })} /> : cut.motionDirection}</td>
                  <td>{editing ? <textarea value={cut.transition || ""} onChange={(event) => updateCut(cut.id, { transition: event.target.value })} /> : cut.transition}</td>
                  <td>
                    <p>{cut.requiredSources.join(" · ")}</p>
                    {editing ? <textarea value={cut.generationPrompt || ""} onChange={(event) => updateCut(cut.id, { generationPrompt: event.target.value })} /> : <small>{cut.generationPrompt}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.tableSection}>
        <h2>장면별 참고 이미지·제작 메모</h2>
        <div className={styles.tableScroll}>
          <table className={styles.scriptTable}>
            <colgroup>
              <col className={styles.sceneColumn} />
              <col className={styles.captionColumn} />
              <col className={styles.visualColumn} />
              <col className={styles.imageColumn} />
              <col className={styles.imageColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>장면</th>
                <th>자막</th>
                <th>영상 장면</th>
                <th>참고 이미지 1</th>
                <th>참고 이미지 2</th>
              </tr>
            </thead>
            <tbody>
              {draft.cuts.map((cut, index) => {
                const isExpanded = expanded.has(cut.id);
                return (
                  <Fragment key={cut.id}>
                    <tr>
                      <td className={styles.sceneCell}>
                        {editing ? (
                          <input
                            aria-label={`${index + 1}번 장면명`}
                            onChange={(event) =>
                              updateCut(cut.id, { sceneName: event.target.value })
                            }
                            value={cut.sceneName}
                          />
                        ) : (
                          <strong>{cut.sceneName || `장면 ${cut.cutNumber}`}</strong>
                        )}
                        <small>
                          {cut.startSecond}-{cut.endSecond}초
                        </small>
                        <button
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(cut.id)) next.delete(cut.id);
                              else next.add(cut.id);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? "상세 닫기" : "상세 보기"}
                        </button>
                        {editing ? (
                          <div className={styles.rowActions}>
                            <button
                              disabled={index === 0}
                              onClick={() => moveScene(cut.id, -1)}
                              title="위로 이동"
                            >
                              ↑
                            </button>
                            <button
                              disabled={index === draft.cuts.length - 1}
                              onClick={() => moveScene(cut.id, 1)}
                              title="아래로 이동"
                            >
                              ↓
                            </button>
                            <button onClick={() => cloneScene(cut)}>복제</button>
                            <button
                              disabled={draft.cuts.length <= 1}
                              onClick={() => deleteScene(cut)}
                            >
                              삭제
                            </button>
                          </div>
                        ) : (
                          <button
                            className={styles.rowCopy}
                            onClick={() =>
                              copy(
                                `${cut.sceneName}\n자막: ${cut.caption}\n영상 장면: ${cut.sceneDescription}`,
                                `${cut.sceneName} 내용을 복사했습니다.`
                              )
                            }
                          >
                            장면 복사
                          </button>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <textarea
                            aria-label={`${cut.sceneName} 자막`}
                            onChange={(event) => updateCut(cut.id, { caption: event.target.value })}
                            value={cut.caption}
                          />
                        ) : (
                          <p className={styles.captionText}>{cut.caption}</p>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <textarea
                            aria-label={`${cut.sceneName} 영상 장면`}
                            className={styles.visualTextarea}
                            onChange={(event) =>
                              updateCut(cut.id, { sceneDescription: event.target.value })
                            }
                            value={cut.sceneDescription}
                          />
                        ) : (
                          <p>{cut.sceneDescription}</p>
                        )}
                      </td>
                      {[0, 1].map((slot) => {
                        const image = cut.referenceImages[slot];
                        const key = `${cut.id}-${slot}`;
                        return (
                          <td key={slot}>
                            {editing ? (
                              <div
                                className={styles.referenceEditor}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const file = event.dataTransfer.files[0];
                                  if (file) uploadSceneImage(cut.id, slot, file);
                                }}
                              >
                                {image ? (
                                  <>
                                    <ReferencePreview image={image} onOpen={setPreviewImage} />
                                    <label>
                                      설명
                                      <input
                                        onChange={(event) => {
                                          const next = [...cut.referenceImages];
                                          next[slot] = {
                                            ...image,
                                            description: event.target.value,
                                          };
                                          updateCut(cut.id, { referenceImages: next });
                                        }}
                                        value={image.description}
                                      />
                                    </label>
                                    <label className={styles.requiredCheck}>
                                      <input
                                        checked={image.required}
                                        onChange={(event) => {
                                          const next = [...cut.referenceImages];
                                          next[slot] = { ...image, required: event.target.checked };
                                          updateCut(cut.id, { referenceImages: next });
                                        }}
                                        type="checkbox"
                                      />{" "}
                                      필수 사용
                                    </label>
                                    <div>
                                      <label className={styles.fileButton}>
                                        교체
                                        <input
                                          accept="image/jpeg,image/png,image/webp"
                                          onChange={(event) =>
                                            event.target.files?.[0] &&
                                            uploadSceneImage(cut.id, slot, event.target.files[0])
                                          }
                                          type="file"
                                        />
                                      </label>
                                      <button
                                        onClick={() =>
                                          updateCut(cut.id, {
                                            referenceImages: cut.referenceImages.filter(
                                              (_, imageIndex) => imageIndex !== slot
                                            ),
                                          })
                                        }
                                      >
                                        삭제
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span>드래그 앤 드롭</span>
                                    <label className={styles.fileButton}>
                                      파일 선택
                                      <input
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={(event) =>
                                          event.target.files?.[0] &&
                                          uploadSceneImage(cut.id, slot, event.target.files[0])
                                        }
                                        type="file"
                                      />
                                    </label>
                                    <input
                                      onChange={(event) =>
                                        setExternalUrls((current) => ({
                                          ...current,
                                          [key]: event.target.value,
                                        }))
                                      }
                                      placeholder="https:// 이미지 URL"
                                      type="url"
                                      value={externalUrls[key] || ""}
                                    />
                                    <button
                                      disabled={!externalUrls[key]?.trim()}
                                      onClick={() => addExternalImage(cut.id, slot)}
                                    >
                                      URL 등록
                                    </button>
                                  </>
                                )}
                                {imageProgress[key] ? (
                                  <progress max={100} value={imageProgress[key]} />
                                ) : null}
                              </div>
                            ) : (
                              <ReferencePreview image={image} onOpen={setPreviewImage} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded ? (
                      <tr className={styles.detailRow}>
                        <td colSpan={5}>
                          <div className={styles.detailGrid}>
                            <label>
                              예상 시간
                              <div>
                                <input
                                  disabled={!editing}
                                  min={0}
                                  onChange={(event) =>
                                    updateCut(cut.id, { startSecond: Number(event.target.value) })
                                  }
                                  type="number"
                                  value={cut.startSecond}
                                />
                                <span>~</span>
                                <input
                                  disabled={!editing}
                                  max={project.duration}
                                  onChange={(event) =>
                                    updateCut(cut.id, { endSecond: Number(event.target.value) })
                                  }
                                  type="number"
                                  value={cut.endSecond}
                                />
                                <span>초</span>
                              </div>
                            </label>
                            <label>
                              내레이션
                              <textarea
                                disabled={!editing}
                                onChange={(event) =>
                                  updateCut(cut.id, { narration: event.target.value })
                                }
                                value={cut.narration}
                              />
                            </label>
                            <label>
                              필요 소스
                              <textarea
                                disabled={!editing}
                                onChange={(event) =>
                                  updateCut(cut.id, {
                                    requiredSources: event.target.value
                                      .split("\n")
                                      .map((item) => item.trim())
                                      .filter(Boolean),
                                  })
                                }
                                value={cut.requiredSources.join("\n")}
                              />
                            </label>
                            <label>
                              추가 제작 메모
                              <textarea
                                disabled={!editing}
                                onChange={(event) =>
                                  updateCut(cut.id, { productionMemo: event.target.value })
                                }
                                value={cut.productionMemo}
                              />
                            </label>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.productionNotes}>
        <strong>전체 제작 메모</strong>
        {editing ? (
          <textarea
            onChange={(event) => {
              setProductionNotes(event.target.value);
              setDirty(true);
            }}
            value={productionNotes}
          />
        ) : (
          <p>
            {productionNotes ||
              project.brandGuideline.designerNotes ||
              "등록된 전체 제작 메모가 없습니다."}
          </p>
        )}
      </section>

      <section className={styles.auditSection}>
        <h2>제작 이력</h2>
        <div>
          <span>
            대본 최초 생성 <b>{formatDate(project.milestones.scriptCreatedAt)}</b>
          </span>
          <span>
            대본 확정 <b>{formatDate(project.milestones.scriptFinalizedAt)}</b>
          </span>
          <span>
            작업 시작 <b>{formatDate(project.milestones.productionStartedAt)}</b>
          </span>
          <span>
            영상 업로드 <b>{formatDate(project.milestones.videoUploadedAt)}</b>
          </span>
          <span>
            수정 요청 <b>{formatDate(project.milestones.revisionRequestedAt)}</b>
          </span>
          <span>
            최종 승인 <b>{formatDate(project.milestones.approvedAt)}</b>
          </span>
        </div>
        <details>
          <summary>저장된 대본 버전 보기·복원</summary>
          {[...project.scriptRevisions]
            .filter((revision) => revision.conceptId === draft.id)
            .reverse()
            .map((revision) => (
              <div key={revision.id}>
                <span>
                  rev.{revision.revision} · {formatDate(revision.changedAt)} · {revision.changedBy}
                </span>
                <b>{revision.snapshot.openingHook}</b>
                {project.status !== "approved" ? (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      window.confirm(`rev.${revision.revision} 대본으로 복원할까요?`) &&
                      void patchProject(
                        {
                          action: "restore-script-revision",
                          revisionId: revision.id,
                          actor: project.marketerName,
                        },
                        `rev.${revision.revision} 대본을 새 버전으로 복원했습니다.`
                      )
                    }
                  >
                    이 버전 복원
                  </button>
                ) : null}
              </div>
            ))}
        </details>
      </section>

      {previewImage ? (
        <div
          className={styles.previewBackdrop}
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <div className={styles.previewModal} onClick={(event) => event.stopPropagation()}>
            <button aria-label="미리보기 닫기" onClick={() => setPreviewImage(null)}>
              ×
            </button>
            <img alt={previewImage.description || previewImage.name} src={previewImage.filePath} />
            <strong>{previewImage.description || previewImage.name}</strong>
            <span>
              {fileSize(previewImage.size)}
              {previewImage.required ? " · 필수 사용" : ""}
            </span>
          </div>
        </div>
      ) : null}
    </main>
  );
}

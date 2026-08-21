"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  type VideoConcept,
  type VideoProject,
} from "../../lib/video-collaboration/types";
import { VIDEO_HOOK_LABELS } from "../../lib/video-collaboration/workflow";
import styles from "./VideoPlanning.module.css";

function formatTime(value: number) {
  return Number.isInteger(value) ? `${value}초` : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}초`;
}

export function VideoPlanningConceptWorkspace({ projectId, conceptId }: { projectId: string; conceptId: string }) {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [concept, setConcept] = useState<VideoConcept | null>(null);
  const [draft, setDraft] = useState<VideoConcept | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(false);
  const generationStarted = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/video-projects/${projectId}/concepts/${conceptId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "기획안을 불러오지 못했습니다.");
    setProject(payload.project);
    setConcept(payload.concept);
    setDraft(payload.concept);
    return { project: payload.project as VideoProject, concept: payload.concept as VideoConcept };
  }, [projectId, conceptId]);

  const generateDetail = useCallback(async (action: "generate-detail" | "regenerate-detail" = "generate-detail", actor = "마케터") => {
    setBusy("detail");
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts/${conceptId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, actor }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "자막·장면안 생성에 실패했습니다.");
      setProject(payload.project);
      setConcept(payload.concept);
      setDraft(payload.concept);
      setSuccess(`${payload.concept.cuts.length}개 구간의 자막과 영상 장면안을 만들었습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "자막·장면안 생성 실패");
      await load().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }, [conceptId, load, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .then((loaded) => {
          if (loaded.concept.cuts.length < 15 && !generationStarted.current) {
            generationStarted.current = true;
            void generateDetail("generate-detail", loaded.project.marketerName || "마케터");
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "조회 실패"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [generateDetail, load]);

  function updateCut(cutId: string, field: "caption" | "sceneDescription", value: string) {
    setDraft((current) => current ? { ...current, cuts: current.cuts.map((cut) => cut.id === cutId ? { ...cut, [field]: value } : cut) } : current);
  }

  async function saveDraft() {
    if (!project || !draft) return;
    setBusy("save");
    setError("");
    try {
      const next = { ...draft, fullScript: draft.cuts.map((cut) => cut.caption).join(" ") };
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-script", actor: project.marketerName, conceptId, concept: next, createRevision: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "기획안 저장 실패");
      const saved = payload.project.concepts.find((item: VideoConcept) => item.id === conceptId);
      setProject(payload.project);
      setConcept(saved);
      setDraft(saved);
      setEditing(false);
      setSuccess("수정한 자막과 장면안을 저장했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기획안 저장 실패");
    } finally {
      setBusy("");
    }
  }

  async function regenerateCut(cutId: string, action: "regenerate-caption" | "regenerate-scene") {
    if (!project) return;
    setBusy(`${action}:${cutId}`);
    setError("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}/concepts/${conceptId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, cutId, actor: project.marketerName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "구간 재생성 실패");
      const updated = payload.project.concepts.find((item: VideoConcept) => item.id === conceptId);
      setProject(payload.project);
      setConcept(updated);
      setDraft(updated);
      setSuccess(action === "regenerate-caption" ? "선택한 자막을 다시 만들었습니다." : "선택한 장면 설명을 다시 만들었습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "구간 재생성 실패");
    } finally {
      setBusy("");
    }
  }

  function copyPlan() {
    if (!concept) return;
    const text = concept.cuts.map((cut, index) => `${index + 1}. ${formatTime(cut.startSecond)}–${formatTime(cut.endSecond)}\n자막: ${cut.caption}\n장면: ${cut.sceneDescription}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => setSuccess("자막과 장면안을 복사했습니다.")).catch(() => setError("기획안을 복사하지 못했습니다."));
  }

  if (loading && !project) return <main className={styles.page}><div className={styles.empty}>자막과 장면안을 불러오는 중입니다.</div></main>;
  if (!project || !concept || !draft) return <main className={styles.page}><div className={styles.error}>{error || "기획안을 찾지 못했습니다."}</div></main>;
  const format = VIDEO_CONCEPT_FORMAT_OPTIONS.find((option) => option.id === concept.conceptFormat);

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href={`/video-planning/${projectId}`}>← 영상 기획으로 돌아가기</Link>
          <p className={styles.eyebrow}>{format?.title || VIDEO_HOOK_LABELS[concept.hookType]} · {project.duration}초</p>
          <h1>{concept.title}</h1>
          <p>완성 영상이 아니라 제작자가 실행할 자막과 영상 장면 설명입니다.</p>
        </div>
        <div className={styles.topActions}>
          <button className={styles.primaryButton} onClick={copyPlan}>자막·장면안 복사</button>
          <button className={styles.ghostButton} disabled={!concept.cuts.length} onClick={() => setEditing((value) => !value)}>{editing ? "수정 취소" : "직접 수정"}</button>
          <button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => generateDetail("regenerate-detail", project.marketerName)}>전체 다시 만들기</button>
        </div>
      </header>

      {error ? <div className={styles.error}><strong>자막·장면안 생성에 실패했습니다.</strong>{error}<div className={styles.errorActions}><button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => generateDetail(concept.cuts.length ? "regenerate-detail" : "generate-detail", project.marketerName)}>다시 시도</button></div></div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {busy === "detail" ? <div className={styles.generationNotice}><span className={styles.loadingDot} /><div><strong>자막과 영상 장면안을 작성하고 있습니다.</strong><p>선택한 콘셉트의 화면 문법을 유지하며 구간별로 정리합니다.</p></div></div> : null}

      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div><h2>자막과 영상 장면안</h2><p>{concept.cuts.length ? `${concept.cuts.length}개 구간 · 이미지 생성 없음` : "기획안을 생성하고 있습니다."}</p></div>
          {editing ? <button className={styles.primaryButton} disabled={busy === "save"} onClick={saveDraft}>{busy === "save" ? "저장 중…" : "수정 내용 저장"}</button> : null}
        </div>
        {concept.cuts.length ? (
          <div className={styles.scenePlanList}>
            {draft.cuts.map((cut, index) => (
              <article className={styles.scenePlanCard} key={cut.id}>
                <div className={styles.scenePlanIndex}><span>{String(index + 1).padStart(2, "0")}</span><small>{formatTime(cut.startSecond)}–{formatTime(cut.endSecond)}</small></div>
                <div className={styles.subtitleColumn}>
                  <strong>자막</strong>
                  {editing ? <textarea aria-label={`${index + 1}번 자막`} value={cut.caption} onChange={(event) => updateCut(cut.id, "caption", event.target.value)} /> : <p>{cut.caption}</p>}
                  <button disabled={Boolean(busy)} onClick={() => regenerateCut(cut.id, "regenerate-caption")}>{busy === `regenerate-caption:${cut.id}` ? "생성 중…" : "자막 다시 생성"}</button>
                </div>
                <div className={styles.sceneDescriptionColumn}>
                  <strong>영상 장면</strong>
                  {editing ? <textarea aria-label={`${index + 1}번 영상 장면`} value={cut.sceneDescription} onChange={(event) => updateCut(cut.id, "sceneDescription", event.target.value)} /> : <p>{cut.sceneDescription}</p>}
                  <button disabled={Boolean(busy)} onClick={() => regenerateCut(cut.id, "regenerate-scene")}>{busy === `regenerate-scene:${cut.id}` ? "생성 중…" : "장면 다시 생성"}</button>
                </div>
              </article>
            ))}
          </div>
        ) : <div className={styles.empty}>{busy === "detail" ? "자막과 영상 장면안을 생성하고 있습니다." : "아직 생성된 기획안이 없습니다."}</div>}
      </section>
    </main>
  );
}

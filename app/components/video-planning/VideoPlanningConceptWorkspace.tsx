"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  type VideoConcept,
  type VideoProject,
} from "../../lib/video-collaboration/types";
import { VIDEO_HOOK_LABELS } from "../../lib/video-collaboration/workflow";
import { assignPlanningTimeline } from "../../lib/video-collaboration/planningValidation";
import { useVideoPlanningOptions } from "./useVideoPlanningOptions";
import styles from "./VideoPlanning.module.css";

function formatTime(value: number) {
  return Number.isInteger(value)
    ? `${value}초`
    : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}초`;
}

type DetailGenerationPayload = {
  ok?: boolean;
  project?: VideoProject;
  concept?: VideoConcept;
  reused?: boolean;
  error?: string;
  failure?: { code?: string; message?: string };
};

const detailGenerationRequests = new Map<
  string,
  Promise<{
    response: Response;
    payload: DetailGenerationPayload;
  }>
>();

function requestDetailGeneration(input: {
  projectId: string;
  conceptId: string;
  action: "generate-detail" | "regenerate-detail";
  actor: string;
  feedback: string;
}) {
  const requestKey = `${input.projectId}:${input.conceptId}:${input.action}:${input.feedback}`;
  const existing = detailGenerationRequests.get(requestKey);
  if (existing) return existing;
  const request = fetch(`/api/video-projects/${input.projectId}/concepts/${input.conceptId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: input.action,
      actor: input.actor,
      feedback: input.feedback,
    }),
  })
    .then(async (response) => ({
      response,
      payload: (await response.json()) as DetailGenerationPayload,
    }))
    .finally(() => {
      detailGenerationRequests.delete(requestKey);
    });
  detailGenerationRequests.set(requestKey, request);
  return request;
}

export function VideoPlanningConceptWorkspace({
  projectId,
  conceptId,
}: {
  projectId: string;
  conceptId: string;
}) {
  const router = useRouter();
  const { people } = useVideoPlanningOptions();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [concept, setConcept] = useState<VideoConcept | null>(null);
  const [draft, setDraft] = useState<VideoConcept | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(false);
  const [designerName, setDesignerName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const generationStarted = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/video-projects/${projectId}/concepts/${conceptId}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "기획안을 불러오지 못했습니다.");
    setProject(payload.project);
    setConcept(payload.concept);
    setDraft(payload.concept);
    setDesignerName(payload.project.designerName || "");
    setDeadline(payload.project.deadline || "");
    return { project: payload.project as VideoProject, concept: payload.concept as VideoConcept };
  }, [projectId, conceptId]);

  const generateDetail = useCallback(
    async (
      action: "generate-detail" | "regenerate-detail" = "generate-detail",
      actor = "마케터"
    ) => {
      setBusy("detail");
      setError("");
      setSuccess("");
      try {
        const { response, payload } = await requestDetailGeneration({
          projectId,
          conceptId,
          action,
          actor,
          feedback: action === "regenerate-detail" ? revisionFeedback : "",
        });
        if (!response.ok && payload.failure?.code === "GENERATION_ALREADY_RUNNING") {
          setSuccess(
            "같은 자막·장면안 생성이 이미 진행 중입니다. 완료된 저장 결과를 자동으로 다시 확인합니다."
          );
          window.setTimeout(() => void load().catch(() => undefined), 2_000);
          return;
        }
        if (!response.ok) throw new Error(payload.error || "자막·장면안 생성에 실패했습니다.");
        if (!payload.project || !payload.concept)
          throw new Error("저장된 자막·장면안 응답을 확인하지 못했습니다.");
        setProject(payload.project);
        setConcept(payload.concept);
        setDraft(payload.concept);
        setSuccess(
          payload.reused
            ? "이미 저장된 유효한 자막과 영상 장면안을 불러왔습니다."
            : `${payload.concept.cuts.length}개 구간의 자막과 영상 장면안을 만들었습니다.`
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "자막·장면안 생성 실패");
        await load().catch(() => undefined);
      } finally {
        setBusy("");
      }
    },
    [conceptId, load, projectId, revisionFeedback]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .then((loaded) => {
          const reusable =
            loaded.concept.detailStatus === "ready" &&
            loaded.concept.validation?.valid === true &&
            loaded.concept.cuts.length >= 15;
          if (!reusable && !generationStarted.current) {
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
    setDraft((current) =>
      current
        ? {
            ...current,
            cuts: current.cuts.map((cut) => (cut.id === cutId ? { ...cut, [field]: value } : cut)),
          }
        : current
    );
  }

  function moveCut(index: number, offset: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= current.cuts.length) return current;
      const cuts = [...current.cuts];
      [cuts[index], cuts[nextIndex]] = [cuts[nextIndex], cuts[index]];
      return {
        ...current,
        cuts: cuts.map((cut, cutIndex) => ({ ...cut, cutNumber: cutIndex + 1 })),
      };
    });
  }

  function deleteCut(cutId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            cuts: current.cuts
              .filter((cut) => cut.id !== cutId)
              .map((cut, index) => ({ ...cut, cutNumber: index + 1 })),
          }
        : current
    );
  }

  function addCut() {
    setDraft((current) => {
      if (!current) return current;
      const previous = current.cuts.at(-1);
      return {
        ...current,
        cuts: [
          ...current.cuts,
          {
            id: crypto.randomUUID(),
            cutNumber: current.cuts.length + 1,
            sceneName: "추가 장면",
            startSecond: previous?.endSecond || 0,
            endSecond: previous?.endSecond || 0,
            sceneDescription:
              "등장인물·장소·행동·표정·구도·제품 노출·B-roll·전환·재사용 여부를 입력하세요.",
            caption: "새 자막",
            narration: "",
            requiredSources: [],
            referenceImages: [],
            productionMemo: "",
          },
        ],
      };
    });
  }

  async function persistAssignment() {
    if (!project) throw new Error("프로젝트 정보를 불러오지 못했습니다.");
    const response = await fetch(`/api/video-projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update-details",
        actor: project.marketerName,
        changes: { designerName, deadline },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "담당 정보를 저장하지 못했습니다.");
    setProject(payload.project);
    return payload.project as VideoProject;
  }

  async function updateAssignment() {
    setBusy("assignment");
    setError("");
    try {
      await persistAssignment();
      setSuccess("담당 디자이너와 마감일을 저장했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "담당 정보 저장 실패");
    } finally {
      setBusy("");
    }
  }

  async function selectOrRequest(action: "select-concept" | "request-production") {
    if (!project) return;
    setBusy(action);
    setError("");
    try {
      if (action === "request-production" && !designerName)
        throw new Error("제작 요청 전에 담당 디자이너를 지정해 주세요.");
      if (
        action === "request-production" &&
        (project.designerName !== designerName || project.deadline !== deadline)
      )
        await persistAssignment();
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          actor: project.marketerName,
          conceptId,
          deadline,
          requestNote,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      setProject(payload.project);
      if (action === "select-concept") {
        setSuccess("이 콘셉트를 선택했습니다.");
      } else {
        router.push(`/video-planning/${projectId}/production`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청 처리 실패");
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!project || !draft) return;
    setBusy("save");
    setError("");
    try {
      const cuts = assignPlanningTimeline(draft.cuts, project.duration);
      const next = { ...draft, cuts, fullScript: cuts.map((cut) => cut.caption).join(" ") };
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save-script",
          actor: project.marketerName,
          conceptId,
          concept: next,
          createRevision: true,
        }),
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
      setSuccess(
        action === "regenerate-caption"
          ? "선택한 자막을 다시 만들었습니다."
          : "선택한 장면 설명을 다시 만들었습니다."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "구간 재생성 실패");
    } finally {
      setBusy("");
    }
  }

  function copyPlan() {
    if (!concept) return;
    const text = concept.cuts
      .map(
        (cut, index) =>
          `${index + 1}. ${formatTime(cut.startSecond)}–${formatTime(cut.endSecond)}\n자막: ${cut.caption}\n장면: ${cut.sceneDescription}`
      )
      .join("\n\n");
    navigator.clipboard
      .writeText(text)
      .then(() => setSuccess("자막과 장면안을 복사했습니다."))
      .catch(() => setError("기획안을 복사하지 못했습니다."));
  }

  if (loading && !project)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>자막과 장면안을 불러오는 중입니다.</div>
      </main>
    );
  if (!project || !concept || !draft)
    return (
      <main className={styles.page}>
        <div className={styles.error}>{error || "기획안을 찾지 못했습니다."}</div>
      </main>
    );
  const format = VIDEO_CONCEPT_FORMAT_OPTIONS.find((option) => option.id === concept.conceptFormat);

  return (
    <main className={styles.page}>
      <header className={styles.detailHero}>
        <div>
          <Link href={`/video-planning/${projectId}`}>← 영상 기획으로 돌아가기</Link>
          <p className={styles.eyebrow}>
            {format?.title || VIDEO_HOOK_LABELS[concept.hookType]} · {project.duration}초
          </p>
          <h1>{concept.title}</h1>
          <p>완성 영상이 아니라 제작자가 실행할 자막과 영상 장면 설명입니다.</p>
        </div>
        <div className={styles.topActions}>
          <button
            className={styles.secondaryButton}
            disabled={project.selectedConceptId === conceptId || Boolean(busy)}
            onClick={() => selectOrRequest("select-concept")}
          >
            {project.selectedConceptId === conceptId ? "선택된 콘셉트" : "이 콘셉트 선택"}
          </button>
          <button className={styles.primaryButton} onClick={copyPlan}>
            자막·장면안 복사
          </button>
          <button
            className={styles.ghostButton}
            disabled={!concept.cuts.length}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "수정 취소" : "직접 수정"}
          </button>
          <button
            className={styles.secondaryButton}
            disabled={Boolean(busy)}
            onClick={() => generateDetail("regenerate-detail", project.marketerName)}
          >
            전체 다시 만들기
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>
          <strong>자막·장면안 생성에 실패했습니다.</strong>
          {error}
          <div className={styles.errorActions}>
            <button
              className={styles.secondaryButton}
              disabled={Boolean(busy)}
              onClick={() =>
                generateDetail(
                  concept.cuts.length ? "regenerate-detail" : "generate-detail",
                  project.marketerName
                )
              }
            >
              다시 시도
            </button>
          </div>
        </div>
      ) : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {busy === "detail" ? (
        <div className={styles.generationNotice}>
          <span className={styles.loadingDot} />
          <div>
            <strong>자막과 영상 장면안을 작성하고 있습니다.</strong>
            <p>보통 45~90초가 걸립니다. 누락된 촬영 요소는 장면별로 즉시 자동 보완합니다.</p>
          </div>
        </div>
      ) : null}

      <section className={styles.summaryPanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>자막과 영상 장면안</h2>
            <p>
              {concept.cuts.length
                ? `${concept.cuts.length}개 구간 · 이미지 생성 없음`
                : "기획안을 생성하고 있습니다."}
            </p>
          </div>
          {editing ? (
            <div className={styles.conceptActions}>
              <button className={styles.ghostButton} onClick={addCut}>
                행 추가
              </button>
              <button
                className={styles.primaryButton}
                disabled={busy === "save"}
                onClick={saveDraft}
              >
                {busy === "save" ? "저장 중…" : "수정 내용 저장"}
              </button>
            </div>
          ) : null}
        </div>
        {concept.cuts.length ? (
          <div className={styles.scenePlanList}>
            {draft.cuts.map((cut, index) => (
              <article className={styles.scenePlanCard} key={cut.id}>
                <div className={styles.scenePlanIndex}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <small>
                    {formatTime(cut.startSecond)}–{formatTime(cut.endSecond)}
                  </small>
                </div>
                <div className={styles.subtitleColumn}>
                  <strong>자막</strong>
                  {editing ? (
                    <textarea
                      aria-label={`${index + 1}번 자막`}
                      value={cut.caption}
                      onChange={(event) => updateCut(cut.id, "caption", event.target.value)}
                    />
                  ) : (
                    <p>{cut.caption}</p>
                  )}
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => regenerateCut(cut.id, "regenerate-caption")}
                  >
                    {busy === `regenerate-caption:${cut.id}` ? "생성 중…" : "자막 다시 생성"}
                  </button>
                  {editing ? (
                    <div className={styles.rowActions}>
                      <button onClick={() => moveCut(index, -1)}>위로</button>
                      <button onClick={() => moveCut(index, 1)}>아래로</button>
                      <button onClick={() => deleteCut(cut.id)}>행 삭제</button>
                    </div>
                  ) : null}
                </div>
                <div className={styles.sceneDescriptionColumn}>
                  <strong>영상 장면</strong>
                  {editing ? (
                    <textarea
                      aria-label={`${index + 1}번 영상 장면`}
                      value={cut.sceneDescription}
                      onChange={(event) =>
                        updateCut(cut.id, "sceneDescription", event.target.value)
                      }
                    />
                  ) : (
                    <p>{cut.sceneDescription}</p>
                  )}
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => regenerateCut(cut.id, "regenerate-scene")}
                  >
                    {busy === `regenerate-scene:${cut.id}` ? "생성 중…" : "장면 다시 생성"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            {busy === "detail"
              ? "자막과 영상 장면안을 생성하고 있습니다."
              : "아직 생성된 기획안이 없습니다."}
          </div>
        )}
      </section>
      <section className={styles.requestPanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>수정 요청 반영 재생성</h2>
            <p>
              유지할 부분과 바꿀 부분을 적으면 선택한 콘셉트 안에서 전체 대본을 다시 구성합니다.
            </p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.wide}>
            수정 요청
            <textarea
              value={revisionFeedback}
              onChange={(event) => setRevisionFeedback(event.target.value)}
              placeholder="예: 첫 사건은 유지하고 중반 원산지 설명을 더 짧게, 제품은 3초 안에 등장"
            />
          </label>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={Boolean(busy) || !revisionFeedback.trim()}
          onClick={() => generateDetail("regenerate-detail", project.marketerName)}
        >
          수정 요청으로 전체 재생성
        </button>
      </section>
      <section className={styles.requestPanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>제작 요청</h2>
            <p>콘셉트 검토는 디자이너 없이 가능하지만 제작 요청에는 담당자가 필요합니다.</p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label>
            담당 디자이너
            <select value={designerName} onChange={(event) => setDesignerName(event.target.value)}>
              <option value="">디자이너 미지정</option>
              {people
                .filter((person) => person.role === "designer")
                .map((person) => (
                  <option key={person.name} value={person.name}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            제작 마감일
            <input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          </label>
          <label className={styles.wide}>
            제작 메모
            <textarea
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
            />
          </label>
        </div>
        <div className={styles.conceptActions}>
          <button
            className={styles.ghostButton}
            disabled={Boolean(busy)}
            onClick={updateAssignment}
          >
            담당 정보 저장
          </button>
          <button
            className={styles.primaryButton}
            disabled={Boolean(busy) || project.selectedConceptId !== conceptId}
            onClick={() => selectOrRequest("request-production")}
          >
            현재 대본 버전으로 제작 요청
          </button>
        </div>
        {[
          "production_requested",
          "in_production",
          "marketer_review",
          "revision_requested",
          "approved",
        ].includes(project.status) ? (
          <Link className={styles.secondaryButton} href={`/video-planning/${projectId}/production`}>
            제작·검수 화면 열기
          </Link>
        ) : null}
      </section>
    </main>
  );
}

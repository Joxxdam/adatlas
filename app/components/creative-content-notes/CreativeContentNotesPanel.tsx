"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductInfoForPrompt } from "../../lib/mvp/types";
import type { ContentNoteResolution, CreativeContentNote, CreativeContentNoteScope, CreativeContentNoteType, ResolvedCreativeContentNote } from "../../lib/creative-content-notes/types";

function slug(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

type Props = {
  product: ProductInfoForPrompt;
  onResolvedNotesChange: (params: { advertiserId: string; productId: string; notes: ResolvedCreativeContentNote[] }) => void;
};

const noteTypeLabels: Record<CreativeContentNoteType, string> = {
  TONE_AND_MANNER: "톤앤매너",
  DESIGN_GUIDELINE: "디자인 가이드",
  TARGET_AUDIENCE: "핵심 타깃",
  REQUIRED_EVIDENCE: "필수 근거",
  LANDING_PAGE_CAUTION: "랜딩페이지 주의",
  PRODUCT_IMAGE_RULE: "상품 이미지 규칙",
  AVOIDED_HOOK: "피할 후킹",
  ADVERTISER_FEEDBACK: "광고주 피드백",
  REVIEW_INSIGHT: "리뷰 인사이트",
  ADDITIONAL_NOTE: "추가 참고",
  TONE_OF_VOICE: "말투·톤",
  PREFERRED_HOOK: "선호 후킹",
  MUST_INCLUDE: "필수 포함",
  PROHIBITED_EXPRESSION: "금지 표현",
  PRODUCT_USP: "상품 USP",
  PRICE_POLICY: "가격 정책",
  PROMOTION: "프로모션",
  IMAGE_RULE: "이미지 규칙",
  BACKGROUND_STYLE: "배경 스타일",
  LAYOUT_RULE: "레이아웃 규칙",
  COMPLIANCE: "심의·준수",
  FREEFORM: "기타 참고",
};

export function CreativeContentNotesPanel({ product, onResolvedNotesChange }: Props) {
  const advertiserId = product.creativeContext?.advertiserId || slug(product.copyGuideId || product.brandName || product.advertiserName || "", "direct-advertiser");
  const productId = product.creativeContext?.productId || `direct-${slug(product.landingUrl || product.productName, "product")}`;
  const categoryId = slug(product.category, "category");
  const [notes, setNotes] = useState<CreativeContentNote[]>([]);
  const [resolution, setResolution] = useState<ContentNoteResolution | null>(null);
  const [scope, setScope] = useState<CreativeContentNoteScope>("product");
  const [type, setType] = useState<CreativeContentNoteType>("PRODUCT_USP");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [required, setRequired] = useState(false);
  const [prohibited, setProhibited] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [promotionId, setPromotionId] = useState("");
  const [message, setMessage] = useState("상품·카테고리·광고주 참고사항을 제작 전에 자동 적용합니다.");
  const scopeId = useMemo(() => (scope === "advertiser" ? advertiserId : scope === "category" ? categoryId : scope === "promotion" ? promotionId : productId), [advertiserId, categoryId, productId, promotionId, scope]);

  async function load() {
    const query = new URLSearchParams({ advertiserId, productId, categoryId });
    if (promotionId) query.set("promotionId", promotionId);
    const response = await fetch(`/api/creative-content-notes?${query}`, { cache: "no-store" });
    const payload = (await response.json()) as { notes?: CreativeContentNote[]; resolution?: ContentNoteResolution; error?: string };
    if (!response.ok || !payload.resolution) throw new Error(payload.error || "참고사항을 불러오지 못했습니다.");
    setNotes(payload.notes || []);
    setResolution(payload.resolution);
    onResolvedNotesChange({ advertiserId, productId, notes: payload.resolution.notes });
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch((error) => setMessage(error instanceof Error ? error.message : "참고사항 조회 실패"));
    }, 0);
    return () => window.clearTimeout(timeout);
    // Context identifiers are the only values that change resolution membership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advertiserId, categoryId, productId]);

  async function addNote() {
    if (!title.trim() || !content.trim()) return setMessage("참고사항 제목과 내용을 입력해 주세요.");
    const response = await fetch("/api/creative-content-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertiserId, scope, scopeId, type, title, content, required, prohibited, active: true, startsAt: startsAt ? new Date(`${startsAt}T00:00:00+09:00`).toISOString() : null, endsAt: endsAt ? new Date(`${endsAt}T23:59:59+09:00`).toISOString() : null, source: "user" }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) return setMessage(payload.error || "참고사항 저장 실패");
    setTitle("");
    setContent("");
    setRequired(false);
    setProhibited(false);
    setStartsAt("");
    setEndsAt("");
    await load();
    setMessage("참고사항을 저장하고 현재 제작 컨텍스트에 다시 적용했습니다.");
  }

  async function toggle(note: CreativeContentNote) {
    await fetch("/api/creative-content-notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, active: !note.active }) });
    await load();
  }

  return (
    <details className="creative-content-notes-panel">
      <summary>
        <span>
          <b>광고 콘텐츠 참고사항</b>
          <small>
            적용 {resolution?.notes.length || 0}개 · 저장 {notes.length}개
          </small>
        </span>
        <em className={resolution?.conflicts.some((item) => item.blocking) ? "blocked" : "passed"}>{resolution?.conflicts.some((item) => item.blocking) ? "충돌 확인 필요" : "적용 준비됨"}</em>
      </summary>
      <div className="creative-note-context">
        <span>광고주 {advertiserId}</span>
        <span>카테고리 {categoryId}</span>
        <span>상품 {productId}</span>
      </div>
      {resolution?.conflicts.map((conflict) => (
        <p className="creative-note-conflict" key={conflict.noteIds.join("-")}>
          {conflict.message}
        </p>
      ))}
      {resolution?.notes.length ? (
        <ul className="creative-note-applied-list">
          {resolution.notes.map((note) => (
            <li key={note.id}>
              <span>
                {noteTypeLabels[note.type]} · {note.scope}
              </span>
              <strong>{note.title}</strong>
              <p>{note.content}</p>
              {note.required ? <b>필수</b> : null}
              {note.prohibited ? <b className="prohibited">금지</b> : null}
              <button onClick={() => void toggle(note)} type="button">
                비활성화
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="creative-note-empty">현재 상품에 적용할 활성 참고사항이 없습니다.</p>
      )}
      <div className="creative-note-editor">
        <select onChange={(event) => setScope(event.target.value as CreativeContentNoteScope)} value={scope}>
          <option value="advertiser">광고주 공통</option>
          <option value="category">카테고리</option>
          <option value="product">상품</option>
          <option value="promotion">프로모션</option>
        </select>
        <select onChange={(event) => setType(event.target.value as CreativeContentNoteType)} value={type}>
          {Object.entries(noteTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input onChange={(event) => setTitle(event.target.value)} placeholder="참고사항 제목" value={title} />
        {scope === "promotion" ? <input onChange={(event) => setPromotionId(event.target.value)} placeholder="프로모션 ID" value={promotionId} /> : null}
        <textarea onChange={(event) => setContent(event.target.value)} placeholder="예: 상품 패키지와 라벨은 변형하지 말 것" value={content} />
        <label>
          시작일 <input onChange={(event) => setStartsAt(event.target.value)} type="date" value={startsAt} />
        </label>
        <label>
          종료일 <input onChange={(event) => setEndsAt(event.target.value)} type="date" value={endsAt} />
        </label>
        <label>
          <input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" /> 필수 적용
        </label>
        <label>
          <input checked={prohibited} onChange={(event) => setProhibited(event.target.checked)} type="checkbox" /> 금지 규칙
        </label>
        <button onClick={() => void addNote()} type="button">
          참고사항 저장
        </button>
      </div>
      {notes.filter((note) => !note.active).length ? (
        <details className="creative-note-inactive">
          <summary>비활성 참고사항</summary>
          {notes
            .filter((note) => !note.active)
            .map((note) => (
              <button key={note.id} onClick={() => void toggle(note)} type="button">
                {note.title} 다시 활성화
              </button>
            ))}
        </details>
      ) : null}
      <p className="creative-note-message">{message}</p>
    </details>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  BrandGuideline,
  ProductAnalysisSnapshot,
  VideoDuration,
  VideoFormat,
  VideoObjective,
  VideoReferenceAsset,
} from "../../lib/video-collaboration/types";
import styles from "./VideoCollaboration.module.css";

const emptyGuideline: BrandGuideline = {
  toneAndManner: "",
  primaryAudience: "",
  coreUsps: "",
  requiredPhrases: [],
  forbiddenPhrases: [],
  advertiserRequests: "",
  designerNotes: "",
};

function lines(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function NewVideoProjectWorkspace() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [analysis, setAnalysis] = useState<ProductAnalysisSnapshot | null>(null);
  const [projectName, setProjectName] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [marketerName, setMarketerName] = useState("마케터");
  const [designerName, setDesignerName] = useState("");
  const [duration, setDuration] = useState<VideoDuration>(15);
  const [format, setFormat] = useState<VideoFormat>("short-form");
  const [objective, setObjective] = useState<VideoObjective>("purchase");
  const [additionalRequests, setAdditionalRequests] = useState("");
  const [guideline, setGuideline] = useState<BrandGuideline>(emptyGuideline);
  const [references, setReferences] = useState<VideoReferenceAsset[]>([]);
  const [referenceProgress, setReferenceProgress] = useState(0);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const canCreate = useMemo(
    () =>
      Boolean(
        analysis?.productName &&
        projectName.trim() &&
        advertiserName.trim() &&
        marketerName.trim() &&
        designerName.trim()
      ),
    [analysis, projectName, advertiserName, marketerName, designerName]
  );

  async function analyze() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/video-projects/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productUrl }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "상품 분석에 실패했습니다.");
      const next = payload.snapshot as ProductAnalysisSnapshot;
      setAnalysis(next);
      setAdvertiserName(next.brandName || "");
      setProjectName(`${next.productName} 영상 제작`);
      setGuideline((current) => ({
        ...current,
        primaryAudience: next.targetCustomers[0] || "",
        coreUsps: next.coreUsps.join(" · "),
      }));
      setDirty(true);
      setStep(2);
      setSuccess(
        "기존 상품 분석 기능으로 공개정보를 불러왔습니다. 확인되지 않은 항목은 비워두거나 직접 보완해 주세요."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상품 분석 실패");
    } finally {
      setBusy(false);
    }
  }

  function updateAnalysis<K extends keyof ProductAnalysisSnapshot>(
    key: K,
    value: ProductAnalysisSnapshot[K]
  ) {
    setAnalysis((current) =>
      current ? { ...current, [key]: value, editedAt: new Date().toISOString() } : current
    );
    setDirty(true);
  }

  function uploadReference(file: File) {
    setError("");
    setReferenceProgress(1);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/video-projects/attachments");
    xhr.upload.onprogress = (event) =>
      event.lengthComputable &&
      setReferenceProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(payload.error || "참고 파일 업로드 실패");
      } else {
        setReferences((current) => [...current, payload.asset]);
        setDirty(true);
      }
      setReferenceProgress(0);
    };
    xhr.onerror = () => {
      setError("참고 파일 업로드 중 연결이 끊겼습니다.");
      setReferenceProgress(0);
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  }

  async function createProject() {
    if (!analysis || !canCreate) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/video-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectName,
          advertiserName,
          productUrl,
          marketerName,
          designerName,
          duration,
          format,
          objective,
          additionalRequests,
          referenceAssets: references,
          productAnalysis: analysis,
          brandGuideline: guideline,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "프로젝트 생성에 실패했습니다.");
      setSuccess("프로젝트를 저장했습니다. 서로 다른 후킹의 대본 3개를 생성하고 있습니다.");
      const generation = await fetch(`/api/video-projects/${payload.project.id}/concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "마케터" }),
      });
      setDirty(false);
      if (!generation.ok) {
        router.push(`/video-collaboration/${payload.project.id}?generation=retry`);
      } else {
        router.push(`/video-collaboration/${payload.project.id}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.compactHero}>
        <div>
          <Link href="/video-collaboration">← 프로젝트 목록</Link>
          <p className={styles.eyebrow}>NEW VIDEO PROJECT</p>
          <h1>새 영상 기획 만들기</h1>
        </div>
        <ol className={styles.steps}>
          <li data-active={step >= 1}>1 상품 분석</li>
          <li data-active={step >= 2}>2 분석 확인</li>
          <li data-active={step >= 3}>3 제작 정보</li>
        </ol>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      {step === 1 ? (
        <section className={styles.panel}>
          <div className={styles.sectionTitle}>
            <span>01</span>
            <div>
              <h2>상품 URL 분석</h2>
              <p>기존 상품 추출 API로 상품명·가격·USP·이미지와 공개된 후기 근거를 불러옵니다.</p>
            </div>
          </div>
          <div className={styles.urlRow}>
            <input
              onChange={(event) => {
                setProductUrl(event.target.value);
                setDirty(true);
              }}
              placeholder="https://shop.example.com/product/..."
              type="url"
              value={productUrl}
            />
            <button disabled={busy || !productUrl.trim()} onClick={analyze}>
              {busy ? "분석 중…" : "상품 분석하기"}
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && analysis ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>분석 결과 확인</h2>
              <p>확인된 사실과 직접 입력한 보완 정보를 구분해 저장합니다.</p>
            </div>
            <button className={styles.secondaryButton} onClick={() => setStep(1)}>
              URL 다시 분석
            </button>
          </div>
          {analysis.analysisNotes?.length ? (
            <div className={styles.analysisNote}>{analysis.analysisNotes.join(" ")}</div>
          ) : null}
          <div className={styles.formGrid}>
            <label>
              상품명
              <input
                value={analysis.productName}
                onChange={(event) => updateAnalysis("productName", event.target.value)}
              />
            </label>
            <label>
              브랜드
              <input
                value={analysis.brandName}
                onChange={(event) => updateAnalysis("brandName", event.target.value)}
              />
            </label>
            <label>
              판매가
              <input
                placeholder="확인 불가 시 비워두기"
                value={analysis.price}
                onChange={(event) => updateAnalysis("price", event.target.value)}
              />
            </label>
            <label>
              할인·혜택
              <input
                placeholder="확인 불가 시 비워두기"
                value={analysis.discountInfo}
                onChange={(event) => updateAnalysis("discountInfo", event.target.value)}
              />
            </label>
            <label className={styles.wide}>
              핵심 USP (줄바꿈 구분)
              <textarea
                value={analysis.coreUsps.join("\n")}
                onChange={(event) => updateAnalysis("coreUsps", lines(event.target.value))}
              />
            </label>
            <label>
              주요 특징
              <textarea
                value={analysis.keyFeatures.join("\n")}
                onChange={(event) => updateAnalysis("keyFeatures", lines(event.target.value))}
              />
            </label>
            <label>
              후기·신뢰 근거
              <textarea
                value={analysis.trustSignals.join("\n")}
                onChange={(event) => updateAnalysis("trustSignals", lines(event.target.value))}
              />
            </label>
            <label>
              핵심 타깃
              <textarea
                value={analysis.targetCustomers.join("\n")}
                onChange={(event) => updateAnalysis("targetCustomers", lines(event.target.value))}
              />
            </label>
            <label>
              해결할 고객 문제
              <textarea
                value={analysis.customerProblems.join("\n")}
                onChange={(event) => updateAnalysis("customerProblems", lines(event.target.value))}
              />
            </label>
            <label className={styles.wide}>
              주의사항·표현 제한
              <textarea
                value={analysis.cautionPhrases.join("\n")}
                onChange={(event) => updateAnalysis("cautionPhrases", lines(event.target.value))}
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <button className={styles.primaryButton} onClick={() => setStep(3)}>
              제작 정보 입력
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && analysis ? (
        <>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <span>02</span>
              <div>
                <h2>프로젝트 제작 정보</h2>
                <p>담당자와 영상 규격, 목적을 지정합니다.</p>
              </div>
            </div>
            <div className={styles.formGrid}>
              <label>
                프로젝트명
                <input
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                업체명
                <input
                  value={advertiserName}
                  onChange={(event) => {
                    setAdvertiserName(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                담당 마케터
                <input
                  value={marketerName}
                  onChange={(event) => {
                    setMarketerName(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                담당 디자이너
                <input
                  value={designerName}
                  onChange={(event) => {
                    setDesignerName(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                영상 길이
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value) as VideoDuration)}
                >
                  <option value={15}>15초</option>
                  <option value={30}>30초</option>
                  <option value={60}>60초</option>
                </select>
              </label>
              <label>
                영상 형식
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as VideoFormat)}
                >
                  <option value="short-form">숏폼</option>
                  <option value="reels">릴스</option>
                  <option value="feed">피드</option>
                  <option value="other">기타</option>
                </select>
              </label>
              <label>
                영상 목적
                <select
                  value={objective}
                  onChange={(event) => setObjective(event.target.value as VideoObjective)}
                >
                  <option value="purchase">구매 전환</option>
                  <option value="interest">관심 유도</option>
                  <option value="new-product">신상품 소개</option>
                  <option value="benefit">혜택 안내</option>
                </select>
              </label>
              <label className={styles.wide}>
                추가 제작 요청
                <textarea
                  value={additionalRequests}
                  onChange={(event) => setAdditionalRequests(event.target.value)}
                />
              </label>
              <label className={styles.wide}>
                참고 이미지 또는 PDF (각 15MB 이하)
                <input
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(event) =>
                    event.target.files?.[0] && uploadReference(event.target.files[0])
                  }
                  type="file"
                />
                {referenceProgress ? <progress max={100} value={referenceProgress} /> : null}
                <small>{references.length}개 업로드됨</small>
              </label>
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <span>03</span>
              <div>
                <h2>업체 참고정보</h2>
                <p>필수·금지 문구는 대본 생성과 검증에 반영됩니다.</p>
              </div>
            </div>
            <div className={styles.formGrid}>
              <label>
                브랜드 톤앤매너
                <textarea
                  value={guideline.toneAndManner}
                  onChange={(event) =>
                    setGuideline({ ...guideline, toneAndManner: event.target.value })
                  }
                />
              </label>
              <label>
                주요 고객층
                <textarea
                  value={guideline.primaryAudience}
                  onChange={(event) =>
                    setGuideline({ ...guideline, primaryAudience: event.target.value })
                  }
                />
              </label>
              <label className={styles.wide}>
                핵심 USP
                <textarea
                  value={guideline.coreUsps}
                  onChange={(event) => setGuideline({ ...guideline, coreUsps: event.target.value })}
                />
              </label>
              <label>
                필수 포함 문구
                <textarea
                  value={guideline.requiredPhrases.join("\n")}
                  onChange={(event) =>
                    setGuideline({ ...guideline, requiredPhrases: lines(event.target.value) })
                  }
                />
              </label>
              <label>
                금지 문구
                <textarea
                  value={guideline.forbiddenPhrases.join("\n")}
                  onChange={(event) =>
                    setGuideline({ ...guideline, forbiddenPhrases: lines(event.target.value) })
                  }
                />
              </label>
              <label>
                광고주 요청사항
                <textarea
                  value={guideline.advertiserRequests}
                  onChange={(event) =>
                    setGuideline({ ...guideline, advertiserRequests: event.target.value })
                  }
                />
              </label>
              <label>
                디자이너 제작 참고사항
                <textarea
                  value={guideline.designerNotes}
                  onChange={(event) =>
                    setGuideline({ ...guideline, designerNotes: event.target.value })
                  }
                />
              </label>
            </div>
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} onClick={() => setStep(2)}>
                분석 정보로 돌아가기
              </button>
              <button
                className={styles.primaryButton}
                disabled={!canCreate || busy}
                onClick={createProject}
              >
                {busy ? "저장·대본 생성 중…" : "프로젝트 저장 후 대본 3개 만들기"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

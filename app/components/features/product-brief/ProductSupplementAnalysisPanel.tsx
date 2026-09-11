"use client";

import { useMemo, useState } from "react";
import type {
  ProductInfoForPrompt,
  ProductSupplementAnalysis,
  ProductSupplementCreativeHook,
  ProductSupplementExplorationCategory,
  ProductSupplementExplorationResult,
  ProductSupplementExplorationSeed,
} from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

type SupplementStatus = "idle" | "loading" | "success" | "error";

type InsightTone = "connection" | "audience" | "scenario" | "tone" | "evidence" | "warning" | "danger";

const explorationCategories: Array<{
  id: ProductSupplementExplorationCategory;
  label: string;
  description: string;
}> = [
  { id: "ingredient", label: "원료·성분", description: "원료 자체의 특성·성분·향·질감" },
  { id: "sourcing", label: "산지·재배·채취", description: "산지, 손수확, 재배와 채취 과정" },
  { id: "processing", label: "제조·가공", description: "냉압착, 추출, 숙성·발효 방식" },
  { id: "history", label: "역사·문화", description: "사건·인물·지역 문화와 과거 사용법" },
  { id: "season", label: "계절·시기", description: "계절 변화와 상품이 필요한 순간" },
  { id: "lifestyle", label: "생활·고객 맥락", description: "고객 고민, 타깃과 사회적 상황" },
];

const evidenceLevelLabels: Record<ProductSupplementCreativeHook["evidenceLevel"], string> = {
  verified: "출처 확인",
  "supported-inference": "근거 기반 연결",
  "creative-association": "창작 확장",
};

function readableFileType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("presentation") || normalized.includes("powerpoint")) return "PPTX";
  if (normalized.includes("spreadsheet") || normalized.includes("excel")) return "스프레드시트";
  if (normalized.includes("wordprocessing") || normalized.includes("word")) return "DOCX";
  if (normalized.includes("json")) return "JSON";
  if (normalized.includes("csv")) return "CSV";
  if (normalized.includes("image")) return "이미지";
  if (normalized.includes("text")) return "텍스트";
  return value || "파일";
}

function InsightList(props: { eyebrow: string; title: string; values: string[]; tone: InsightTone }) {
  if (!props.values.length) return null;
  return (
    <article className={styles.supplementInsightCard} data-tone={props.tone}>
      <header>
        <span aria-hidden="true" />
        <div>
          <small>{props.eyebrow}</small>
          <strong>{props.title}</strong>
        </div>
        <b>{props.values.length}</b>
      </header>
      <ol>
        {props.values.map((value, index) => (
          <li key={`${value}-${index}`}>{value}</li>
        ))}
      </ol>
    </article>
  );
}

function promptLine(value: string, max = 260) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function selectedHookPrompt(values: Array<{ result: ProductSupplementExplorationResult; hook: ProductSupplementCreativeHook }>) {
  const sections = values.slice(0, 3).map(({ result, hook }, index) => [
    `${index + 1}. 탐색 소재: ${promptLine(result.seed.title, 100)}`,
    `타깃: ${promptLine(hook.target, 180)}`,
    `배경: ${promptLine(hook.background, 260)}`,
    `후킹 방향: ${promptLine(hook.hook, 220)}`,
    `시각 구현: ${promptLine(hook.visualDirection, 260)}`,
    `문구 방향: ${promptLine(hook.copyDirection, 200)}`,
    `근거와 연결: ${promptLine(hook.evidenceBasis, 220)}`,
  ].filter((line) => !line.endsWith(": ")).join("\n"));
  return `[첨부자료에서 선택한 심층 탐색 방향]\n${sections.join("\n\n")}\n\n[추가 주의사항]\n선택한 역사적 사건·배경·성분·계절·타깃·후킹은 문구로만 설명하지 말고, 인물 또는 캐릭터·배경·소품·행동·문구에 일관되게 반영하여 광고의 의미가 한눈에 이해되도록 구성할 것. 인물이나 캐릭터가 불필요한 경우 억지로 넣지 않되, 핵심 시각 요소와 문구가 동일한 메시지를 전달해야 함.`;
}

function ResearchResultPanel(props: {
  result: ProductSupplementExplorationResult;
  selectedHookKeys: Set<string>;
  onToggleHook: (key: string) => void;
}) {
  return (
    <section className={styles.supplementResearchResult} aria-label={`${props.result.seed.title} 심층 조사 결과`}>
      <header>
        <div>
          <small>WEB RESEARCH</small>
          <h6>{props.result.seed.title}</h6>
        </div>
        <span>웹 심층 조사 완료</span>
      </header>
      <p>{props.result.overview}</p>
      <div className={styles.supplementResearchExplanation}>
        <strong>쉽게 이해하면</strong>
        <p>{props.result.easyExplanation || "선택한 소재를 광고에 연결할 수 있는 방식으로 정리했습니다."}</p>
      </div>
      {props.result.verifiedFacts.length ? (
        <details className={styles.supplementVerifiedFacts}>
          <summary>확인한 사실 {props.result.verifiedFacts.length}개</summary>
          <ul>
            {props.result.verifiedFacts.map((fact, index) => <li key={`${fact}-${index}`}>{fact}</li>)}
          </ul>
        </details>
      ) : null}
      <div className={styles.supplementHookGrid}>
        {props.result.hooks.map((hook) => {
          const hookKey = `${props.result.seed.id}:${hook.id}`;
          const selected = props.selectedHookKeys.has(hookKey);
          return (
            <article className={selected ? styles.supplementHookSelected : ""} key={hookKey}>
              <header>
                <span>{evidenceLevelLabels[hook.evidenceLevel]}</span>
                <label>
                  <input checked={selected} onChange={() => props.onToggleHook(hookKey)} type="checkbox" />
                  추가할 후킹 선택
                </label>
              </header>
              <h6>{hook.title}</h6>
              <dl>
                <div><dt>타깃</dt><dd>{hook.target}</dd></div>
                <div><dt>배경</dt><dd>{hook.background}</dd></div>
                <div><dt>후킹</dt><dd>{hook.hook}</dd></div>
                <div><dt>시각 구현</dt><dd>{hook.visualDirection}</dd></div>
                <div><dt>문구 방향</dt><dd>{hook.copyDirection}</dd></div>
              </dl>
              <p><strong>근거와 연결</strong>{hook.evidenceBasis}</p>
            </article>
          );
        })}
      </div>
      {props.result.cautions.length ? (
        <div className={styles.supplementResearchCautions}>
          <strong>표현할 때 확인할 점</strong>
          {props.result.cautions.map((caution, index) => <span key={`${caution}-${index}`}>{caution}</span>)}
        </div>
      ) : null}
      {props.result.sources.length ? (
        <div className={styles.supplementResearchSources}>
          <strong>조사 출처</strong>
          <div>
            {props.result.sources.map((source) => (
              <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                <span>{source.publisher}</span>
                {source.title}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ProductSupplementAnalysisPanel(props: {
  analysis: ProductSupplementAnalysis | null;
  files: File[];
  product: ProductInfoForPrompt;
  productLoaded: boolean;
  siteAnalysisMode: boolean;
  status: SupplementStatus;
  statusMessage: string;
  onAnalyze: () => void;
  onFilesChange: (files: File[]) => void;
  onInsertPrompt: (value: string) => void;
  onRemoveFile: (index: number) => void;
}) {
  const busy = props.status === "loading";
  const availableCategories = useMemo(() => explorationCategories.filter((category) =>
    props.analysis?.explorationSeeds?.some((seed) => seed.category === category.id)
  ), [props.analysis]);
  const [activeCategory, setActiveCategory] = useState<ProductSupplementExplorationCategory>(availableCategories[0]?.id || "ingredient");
  const [researchResults, setResearchResults] = useState<Record<string, ProductSupplementExplorationResult>>({});
  const [activeResearchSeedId, setActiveResearchSeedId] = useState("");
  const [researchingSeedId, setResearchingSeedId] = useState("");
  const [researchError, setResearchError] = useState("");
  const [selectedHookKeys, setSelectedHookKeys] = useState<Set<string>>(new Set());
  const [insertMessage, setInsertMessage] = useState("");

  const activeSeeds = (props.analysis?.explorationSeeds || []).filter((seed) => seed.category === activeCategory);
  const activeResearchResult = activeResearchSeedId ? researchResults[activeResearchSeedId] : undefined;
  const selectedHooks = useMemo(() => Object.values(researchResults).flatMap((result) =>
    result.hooks.flatMap((hook) => selectedHookKeys.has(`${result.seed.id}:${hook.id}`) ? [{ result, hook }] : [])
  ), [researchResults, selectedHookKeys]);
  const filePointCount = props.analysis?.files.reduce((count, file) => count + file.notablePoints.length, 0) || 0;
  const reviewCount = (props.analysis?.cautions.length || 0)
    + (props.analysis?.files.reduce((count, file) => count + file.warnings.length, 0) || 0);

  async function researchSeed(seed: ProductSupplementExplorationSeed) {
    if (!props.analysis || researchingSeedId) return;
    const cached = researchResults[seed.id];
    if (cached) {
      setActiveResearchSeedId(seed.id);
      return;
    }
    setResearchingSeedId(seed.id);
    setActiveResearchSeedId(seed.id);
    setResearchError("");
    setInsertMessage("");
    try {
      const response = await fetch("/api/extract/product-supplements/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: {
            productName: props.product.productName,
            brandName: props.product.brandName || props.product.advertiserName,
            category: props.product.category,
            price: props.product.price,
            originalPrice: props.product.originalPrice || props.product.oldPrice,
            discountInfo: props.product.discountInfo,
            mainBenefit: props.product.mainBenefit,
            description: props.product.extractedDescription,
            landingUrl: props.product.landingUrl,
          },
          analysis: props.analysis,
          seed,
        }),
      });
      const payload = await response.json() as { ok?: boolean; result?: ProductSupplementExplorationResult; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || "심층 조사에 실패했습니다.");
      setResearchResults((current) => ({ ...current, [seed.id]: payload.result! }));
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "심층 조사에 실패했습니다.");
    } finally {
      setResearchingSeedId("");
    }
  }

  function toggleHook(key: string) {
    setInsertMessage("");
    if (!selectedHookKeys.has(key) && selectedHookKeys.size >= 3) {
      setResearchError("추가 프롬프트에는 후킹을 최대 3개까지 선택할 수 있습니다.");
      return;
    }
    setResearchError("");
    setSelectedHookKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function insertSelectedHooks() {
    if (!selectedHooks.length) return;
    props.onInsertPrompt(selectedHookPrompt(selectedHooks));
    setInsertMessage(`선택한 후킹 ${selectedHooks.length}개를 아래 추가/강조 사항에 입력했습니다.`);
    setResearchError("");
  }

  return (
    <section className={styles.supplementPanel} aria-label="상품 참고자료 분석">
      <div className={styles.supplementUploadHeader}>
        <div>
          <span className={styles.sectionStep}>선택 · 상품 참고자료</span>
          <h4>참고파일도 함께 분석할까요?</h4>
          <p>첨부하지 않아도 기존 상품 분석과 광고 제작은 그대로 사용할 수 있습니다. 먼저 파일 자체만 정리하고, 상품 연결·타깃·후킹은 원하는 소재를 선택할 때 분석합니다.</p>
        </div>
        <label className={styles.supplementFileButton}>
          참고파일 선택
          <input
            accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp"
            disabled={busy}
            multiple
            onChange={(event) => props.onFilesChange(Array.from(event.target.files || []))}
            type="file"
          />
        </label>
      </div>
      <p className={styles.supplementLimit}>PNG·JPG·WEBP·PDF·DOCX·PPTX·XLSX·XLS·TXT·MD·CSV·JSON · 최대 6개 · 파일당 10MB</p>
      {props.files.length ? (
        <div className={styles.supplementFileList} aria-label="선택한 참고파일">
          {props.files.map((file, index) => (
            <span key={`${file.name}-${file.size}-${index}`}>
              <span>{file.name}</span>
              <button aria-label={`${file.name} 제외`} disabled={busy} onClick={() => props.onRemoveFile(index)} type="button">
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {props.files.length ? (
        <button
          className={styles.supplementAnalyzeButton}
          disabled={busy || !props.productLoaded || props.siteAnalysisMode}
          onClick={props.onAnalyze}
          type="button"
        >
          {busy ? "첨부자료 분석 중…" : props.productLoaded && !props.siteAnalysisMode ? "선택한 참고파일 분석하기" : "상품 분석 후 이용 가능"}
        </button>
      ) : null}
      <div aria-live="polite" className={styles.supplementStatus} data-kind={props.status} role="status">
        {busy ? <span aria-hidden="true" /> : null}
        {props.statusMessage}
      </div>

      {props.analysis ? (
        <section className={styles.supplementAnalysisResult} aria-label="첨부자료 분석 결과">
          <div className={styles.supplementResultHeading}>
            <div>
              <span className={styles.sectionStep}>첨부자료 분석 완료</span>
              <h4>{props.analysis.fileCount}개 참고파일 분석 결과</h4>
            </div>
            <span>✓ {props.analysis.usedAi ? "AI 분석 완료" : "기본 내용 확인"}</span>
          </div>

          <div className={styles.supplementSummaryCard}>
            <span className={styles.supplementSummaryMark} aria-hidden="true">✓</span>
            <div>
              <strong>한눈에 보기</strong>
              <p className={styles.supplementOverallSummary}>{props.analysis.overallSummary}</p>
            </div>
          </div>

          <dl className={styles.supplementResultMetrics} aria-label="분석 항목 요약">
            <div>
              <dt>탐색 소재</dt>
              <dd>{props.analysis.explorationSeeds.length}</dd>
            </div>
            <div>
              <dt>자료 주장</dt>
              <dd>{props.analysis.documentClaims.length}</dd>
            </div>
            <div>
              <dt>파일 핵심</dt>
              <dd>{filePointCount}</dd>
            </div>
            <div data-attention={reviewCount > 0 ? "true" : "false"}>
              <dt>확인 필요</dt>
              <dd>{reviewCount}</dd>
            </div>
          </dl>

          {availableCategories.length ? (
            <section className={styles.supplementExploration} aria-label="첨부자료 심층 탐색">
              <div className={styles.supplementGroupHeading}>
                <div>
                  <span>01</span>
                  <div>
                    <h5>원하는 소재를 더 깊게 탐색</h5>
                    <p>탭과 소재를 직접 선택할 때만 인터넷으로 조사합니다. 조사 결과도 제작에는 자동 반영되지 않습니다.</p>
                  </div>
                </div>
              </div>
              <div className={styles.supplementExplorationTabs} role="tablist" aria-label="심층 탐색 관점">
                {availableCategories.map((category) => {
                  const count = props.analysis?.explorationSeeds.filter((seed) => seed.category === category.id).length || 0;
                  return (
                    <button
                      aria-selected={activeCategory === category.id}
                      className={activeCategory === category.id ? styles.supplementExplorationTabActive : ""}
                      key={category.id}
                      onClick={() => {
                        setActiveCategory(category.id);
                        setResearchError("");
                      }}
                      role="tab"
                      type="button"
                    >
                      <span>{category.label}<b>{count}</b></span>
                      <small>{category.description}</small>
                    </button>
                  );
                })}
              </div>
              <div className={styles.supplementSeedList} role="tabpanel">
                {activeSeeds.map((seed) => {
                  const completed = Boolean(researchResults[seed.id]);
                  const loading = researchingSeedId === seed.id;
                  return (
                    <article className={activeResearchSeedId === seed.id ? styles.supplementSeedActive : ""} key={seed.id}>
                      <div>
                        <strong>{seed.title}</strong>
                        <p>{seed.summary}</p>
                        {seed.sourceFileNames.length ? <small>첨부 근거 · {seed.sourceFileNames.join(" · ")}</small> : null}
                      </div>
                      <button disabled={Boolean(researchingSeedId)} onClick={() => void researchSeed(seed)} type="button">
                        {loading ? <><span aria-hidden="true" />인터넷 조사 중…</> : completed ? "조사 결과 보기" : "인터넷 심층 분석"}
                      </button>
                    </article>
                  );
                })}
              </div>
              {researchingSeedId ? (
                <div aria-live="polite" className={styles.supplementResearchProgress} role="status">
                  <span aria-hidden="true" />
                  <div><strong>선택한 소재를 인터넷에서 조사하고 있습니다</strong><small>사실·배경·타깃·후킹·시각 장면을 함께 정리합니다.</small></div>
                </div>
              ) : null}
              {researchError ? <p className={styles.supplementResearchError} role="alert">{researchError}</p> : null}
              {activeResearchResult ? (
                <ResearchResultPanel result={activeResearchResult} selectedHookKeys={selectedHookKeys} onToggleHook={toggleHook} />
              ) : null}
              {Object.keys(researchResults).length ? (
                <div className={styles.supplementPromptInsertBar}>
                  <div>
                    <strong>추가할 후킹 {selectedHooks.length}/3</strong>
                    <small>선택한 내용만 기존 추가/강조 사항 입력란으로 보냅니다.</small>
                  </div>
                  <button disabled={!selectedHooks.length} onClick={insertSelectedHooks} type="button">추가 프롬프트에 입력하기</button>
                </div>
              ) : null}
              {insertMessage ? <p className={styles.supplementInsertMessage} role="status">✓ {insertMessage}</p> : null}
            </section>
          ) : null}

          <section className={styles.supplementResultGroup} aria-label="사실과 주의사항 검토">
            <div className={styles.supplementGroupHeading}>
              <div>
                <span>{availableCategories.length ? "03" : "02"}</span>
                <div>
                  <h5>사실·주의사항 검토</h5>
                  <p>자료에 직접 적힌 주장과 확인이 필요한 내용을 구분해 보세요.</p>
                </div>
              </div>
            </div>
            {props.analysis.documentClaims.length || props.analysis.cautions.length ? (
              <div className={styles.supplementReviewGrid}>
                <InsightList eyebrow="SOURCE FACTS" title="첨부자료에 적힌 주장" values={props.analysis.documentClaims} tone="evidence" />
                <InsightList eyebrow="CAUTION" title="주의해서 볼 내용" values={props.analysis.cautions} tone="warning" />
              </div>
            ) : (
              <p className={styles.supplementClearState}>별도로 확인할 주장이나 충돌·주의사항이 없습니다.</p>
            )}
          </section>

          <details className={styles.supplementFileDetails}>
            <summary>
              <span>
                <b>{availableCategories.length ? "03" : "02"}</b>
                <span>
                  <strong>파일별 상세 근거</strong>
                  <small>{props.analysis.fileCount}개 파일의 요약과 세부 내용을 확인할 수 있습니다.</small>
                </span>
              </span>
              <em>펼쳐보기</em>
            </summary>
            <div>
              {props.analysis.files.map((file, fileIndex) => (
                <article key={`${file.fileName}-${file.fileType}-${fileIndex}`}>
                  <header>
                    <b>{String(fileIndex + 1).padStart(2, "0")}</b>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>{readableFileType(file.fileType)}</small>
                    </div>
                    <span>{file.notablePoints.length}개 핵심</span>
                  </header>
                  <p>{file.summary}</p>
                  {file.notablePoints.length ? (
                    <div className={styles.supplementFilePoints}>
                      <strong>핵심 내용</strong>
                      <ul>
                        {file.notablePoints.map((point, pointIndex) => (
                          <li key={`${point}-${pointIndex}`}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {file.warnings.length ? (
                    <div className={styles.supplementFileWarnings}>
                      <strong>확인 필요</strong>
                      {file.warnings.map((warning, warningIndex) => (
                        <em key={`${warning}-${warningIndex}`}>{warning}</em>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </details>
        </section>
      ) : null}
    </section>
  );
}

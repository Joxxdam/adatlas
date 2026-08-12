"use client";

/* eslint-disable @next/next/no-img-element -- generated and local preview images */

import type {
  AdaptiveCreativePlan,
  AdaptiveCreativeRenderResult,
  CreativeGenerationMode,
} from "../../../lib/background-library/types";

import styles from "./AdaptiveCreativePanel.module.css";

const layoutLabels: Record<AdaptiveCreativePlan["layoutType"], string> = {
  "text-left-product-right": "왼쪽 카피형",
  "text-right-product-left": "오른쪽 카피형",
  "text-top-product-bottom": "상단 카피형",
  "text-bottom-product-top": "하단 카피형",
  "centered-product-promotion": "중앙 프로모션형",
  "lifestyle-caption": "라이프스타일 캡션형",
  "editorial-overlay": "에디토리얼 오버레이형",
  "premium-minimal": "프리미엄 미니멀형",
  "split-panel": "분할 패널형",
  "price-focused": "가격 강조형",
  "ingredient-story": "원료 스토리형",
  "people-scene": "인물 장면형",
  "product-grounded": "접지 상품형",
  "fashion-lookbook": "패션 룩북형",
};

const variantLabels: Record<AdaptiveCreativePlan["layoutVariant"], string> = {
  "copy-focused": "겹침 반복형",
  "product-focused": "대형 히어로형",
  "content-focused": "크기 대비형",
};

function percent(value: number) {
  return `${Math.max(0, Math.min(100, (value / 1200) * 100))}%`;
}

export function AdaptiveCreativePanel(props: {
  backgroundFile: string;
  plans: AdaptiveCreativePlan[];
  selectedPlanId: string;
  loading: boolean;
  status: string;
  generationMode: CreativeGenerationMode;
  generating: boolean;
  results: AdaptiveCreativeRenderResult[];
  onSelectPlan: (id: string) => void;
  onChangePlan: (plan: AdaptiveCreativePlan) => void;
  onReset: () => void;
  onGenerationModeChange: (mode: CreativeGenerationMode) => void;
  onGenerateVariants: () => void;
  onUseResult: (result: AdaptiveCreativeRenderResult) => void;
}) {
  const resultCount = props.generationMode === "hook-based" ? 6 : 3;
  const selected = props.plans.find((plan) => plan.id === props.selectedPlanId) || props.plans[0];
  const update = (patch: Partial<AdaptiveCreativePlan>) => {
    if (!selected) return;
    props.onChangePlan({ ...selected, ...patch, updatedAt: new Date().toISOString() });
  };
  const moveText = (axis: "x" | "y", nextValue: number) => {
    if (!selected) return;
    const delta = nextValue - selected.textPlacement[axis];
    update({
      textPlacement: { ...selected.textPlacement, [axis]: nextValue },
      bodyPlacement: {
        ...selected.bodyPlacement,
        [axis]: Math.max(
          24,
          Math.min(
            1176 - selected.bodyPlacement[axis === "x" ? "width" : "height"],
            selected.bodyPlacement[axis] + delta
          )
        ),
      },
    });
  };

  return (
    <section className={styles.panel}>
      <header>
        <span>ADAPTIVE LAYOUT</span>
        <h4>선택한 배경에 맞는 레이아웃 3안</h4>
        <p>단일 대형, 동일 상품 겹침, 큰 상품+작은 상품의 위계가 서로 다른 시안입니다.</p>
      </header>

      {props.loading ? (
        <p className={styles.status}>배경 색상과 합성 영역을 분석하고 있습니다.</p>
      ) : null}
      {!props.loading && props.plans.length ? (
        <div className={styles.planGrid}>
          {props.plans.map((plan) => {
            const active = plan.id === selected?.id;
            return (
              <button
                className={`${styles.planCard} ${active ? styles.selected : ""}`}
                key={plan.id}
                onClick={() => props.onSelectPlan(plan.id)}
                type="button"
              >
                <span className={styles.planPreview}>
                  <img alt="선택 배경 레이아웃 미리보기" src={props.backgroundFile} />
                  <i
                    className={styles.textBlock}
                    style={{
                      left: percent(plan.textPlacement.x),
                      top: percent(plan.textPlacement.y),
                      width: percent(plan.textPlacement.width),
                      height: percent(plan.textPlacement.height),
                    }}
                  />
                  {Array.from({ length: plan.productComposition?.count || 1 }, (_, index) => {
                    const count = plan.productComposition?.count || 1;
                    const support = count > 1 && index < count - 1;
                    const supportScale = 1 - (plan.productComposition?.scaleStep || 0);
                    const direction = index % 2 === 0 ? -1 : 1;
                    const width = plan.productPlacement.width * (support ? supportScale : 1);
                    const height = plan.productPlacement.height * (support ? supportScale : 1);
                    const x = support
                      ? plan.productPlacement.x +
                        direction *
                          plan.productPlacement.width *
                          (1 - (plan.productComposition?.overlapRatio || 0.24))
                      : plan.productPlacement.x;
                    const y = support
                      ? plan.productPlacement.y + plan.productPlacement.height - height
                      : plan.productPlacement.y;
                    return (
                      <i
                        className={styles.productBlock}
                        key={`${plan.id}-product-${index}`}
                        style={{
                          left: percent(x),
                          top: percent(y),
                          width: percent(width),
                          height: percent(height),
                          opacity: support ? 0.7 : 1,
                          transform: `rotate(${support ? direction * 7 : 0}deg)`,
                          zIndex: support ? 2 : 3,
                        }}
                      />
                    );
                  })}
                </span>
                <b>{variantLabels[plan.layoutVariant]}</b>
                <strong>{layoutLabels[plan.layoutType]}</strong>
                <small>{plan.rationale}</small>
                <em>{active ? "선택됨" : "이 레이아웃 선택"}</em>
              </button>
            );
          })}
        </div>
      ) : !props.loading ? (
        <p className={styles.status}>{props.status}</p>
      ) : null}

      {selected ? (
        <details className={styles.editor}>
          <summary>문구·상품·배경 세부 조정</summary>
          <div className={styles.editorGrid}>
            <label>
              상품 가로 위치
              <input
                max={Math.max(24, 1176 - selected.productPlacement.width)}
                min="24"
                onChange={(event) =>
                  update({
                    productPlacement: {
                      ...selected.productPlacement,
                      x: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.productPlacement.x}
              />
            </label>
            <label>
              상품 세로 위치
              <input
                max={Math.max(24, 1176 - selected.productPlacement.height)}
                min="24"
                onChange={(event) =>
                  update({
                    productPlacement: {
                      ...selected.productPlacement,
                      y: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.productPlacement.y}
              />
            </label>
            <label>
              상품 크기
              <input
                max="1.5"
                min="0.6"
                onChange={(event) =>
                  update({
                    productPlacement: {
                      ...selected.productPlacement,
                      scale: Number(event.target.value),
                    },
                  })
                }
                step="0.05"
                type="range"
                value={selected.productPlacement.scale}
              />
            </label>
            <label>
              상품 표현 방식
              <select
                onChange={(event) => {
                  const mode = event.target.value as AdaptiveCreativePlan["productComposition"]["mode"];
                  update({
                    productComposition:
                      mode === "single"
                        ? { mode, count: 1, scaleStep: 0, overlapRatio: 0 }
                        : {
                            mode,
                            count: mode === "repeat-overlap" ? 3 : 2,
                            scaleStep: mode === "repeat-overlap" ? 0.2 : 0.28,
                            overlapRatio: mode === "repeat-overlap" ? 0.36 : 0.24,
                          },
                  });
                }}
                value={selected.productComposition?.mode || "single"}
              >
                <option value="single">상품 1개 크게</option>
                <option value="repeat-overlap">동일 상품 3개 겹침</option>
                <option value="scale-contrast">큰 상품+작은 상품</option>
              </select>
            </label>
            <label>
              문구 가로 위치
              <input
                max={Math.max(24, 1176 - selected.textPlacement.width)}
                min="24"
                onChange={(event) => moveText("x", Number(event.target.value))}
                type="range"
                value={selected.textPlacement.x}
              />
            </label>
            <label>
              문구 세로 위치
              <input
                max={Math.max(24, 1176 - selected.textPlacement.height)}
                min="24"
                onChange={(event) => moveText("y", Number(event.target.value))}
                type="range"
                value={selected.textPlacement.y}
              />
            </label>
            <label>
              문구 정렬
              <select
                onChange={(event) =>
                  update({
                    textPlacement: {
                      ...selected.textPlacement,
                      align: event.target.value as "left" | "center" | "right",
                    },
                    bodyPlacement: {
                      ...selected.bodyPlacement,
                      align: event.target.value as "left" | "center" | "right",
                    },
                  })
                }
                value={selected.textPlacement.align}
              >
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
            </label>
            <label>
              메인 문구 크기
              <input
                max="96"
                min="34"
                onChange={(event) =>
                  update({
                    textPlacement: {
                      ...selected.textPlacement,
                      fontSize: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.textPlacement.fontSize}
              />
            </label>
            <label>
              문구 색상
              <input
                onChange={(event) =>
                  update({
                    colorPalette: {
                      ...selected.colorPalette,
                      headline: event.target.value,
                      body: event.target.value,
                    },
                  })
                }
                type="color"
                value={selected.colorPalette.headline}
              />
            </label>
            <label>
              가격 영역
              <select
                onChange={(event) =>
                  update({
                    pricePlacement: {
                      ...selected.pricePlacement,
                      visible: event.target.value === "show",
                    },
                  })
                }
                value={selected.pricePlacement.visible ? "show" : "hide"}
              >
                <option value="show">표시</option>
                <option value="hide">숨김</option>
              </select>
            </label>
            <label>
              CTA 영역
              <select
                onChange={(event) =>
                  update({
                    ctaPlacement: {
                      ...selected.ctaPlacement,
                      visible: event.target.value === "show",
                    },
                  })
                }
                value={selected.ctaPlacement.visible ? "show" : "hide"}
              >
                <option value="show">표시</option>
                <option value="hide">숨김</option>
              </select>
            </label>
            <label>
              그림자 강도
              <input
                max="0.7"
                min="0.1"
                onChange={(event) =>
                  update({
                    contrastAdjustments: {
                      ...selected.contrastAdjustments,
                      productSeparation: Number(event.target.value),
                    },
                  })
                }
                step="0.05"
                type="range"
                value={selected.contrastAdjustments.productSeparation}
              />
            </label>
            <label>
              배경 밝기
              <input
                max="1.3"
                min="0.6"
                onChange={(event) =>
                  update({
                    backgroundAdjustments: {
                      ...selected.backgroundAdjustments,
                      brightness: Number(event.target.value),
                    },
                  })
                }
                step="0.05"
                type="range"
                value={selected.backgroundAdjustments.brightness}
              />
            </label>
            <label>
              배경 흐림
              <input
                max="16"
                min="0"
                onChange={(event) =>
                  update({
                    backgroundAdjustments: {
                      ...selected.backgroundAdjustments,
                      blur: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.backgroundAdjustments.blur}
              />
            </label>
            <label>
              배경 확대
              <input
                max="1.35"
                min="1"
                onChange={(event) =>
                  update({
                    backgroundAdjustments: {
                      ...selected.backgroundAdjustments,
                      scale: Number(event.target.value),
                    },
                  })
                }
                step="0.01"
                type="range"
                value={selected.backgroundAdjustments.scale}
              />
            </label>
            <label>
              배경 가로 위치
              <input
                max="180"
                min="-180"
                onChange={(event) =>
                  update({
                    backgroundAdjustments: {
                      ...selected.backgroundAdjustments,
                      offsetX: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.backgroundAdjustments.offsetX}
              />
            </label>
            <label>
              배경 세로 위치
              <input
                max="180"
                min="-180"
                onChange={(event) =>
                  update({
                    backgroundAdjustments: {
                      ...selected.backgroundAdjustments,
                      offsetY: Number(event.target.value),
                    },
                  })
                }
                type="range"
                value={selected.backgroundAdjustments.offsetY}
              />
            </label>
          </div>
          <button className={styles.resetButton} onClick={props.onReset} type="button">
            자동 배치로 되돌리기
          </button>
        </details>
      ) : null}

      <section className={styles.batchArea}>
        <div>
          <span>MULTI CREATIVE</span>
          <h4>광고 시안 여러 개 생성</h4>
        </div>
        <div className={styles.modeGrid}>
          {(
            [
              ["diverse-backgrounds", "다양한 배경으로 생성", "서로 다른 배경 3개"],
              ["selected-background", "선택한 배경으로 비교", "같은 배경·서로 다른 레이아웃 3개"],
              ["hook-based", "자동 문구 6개 적용", "문구·배경·레이아웃을 각각 변경"],
            ] as const
          ).map(([value, title, description]) => (
            <button
              className={props.generationMode === value ? styles.modeSelected : ""}
              key={value}
              onClick={() => props.onGenerationModeChange(value)}
              type="button"
            >
              <b>{title}</b>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <button
          className={styles.generateButton}
          disabled={props.generating || !selected}
          onClick={props.onGenerateVariants}
          type="button"
        >
          {props.generating
            ? `시안 ${resultCount}개 생성 중`
            : `선택 모드로 시안 ${resultCount}개 생성`}
        </button>
        {props.results.length ? (
          <div className={styles.resultGrid}>
            {props.results.map((result) => (
              <article key={result.id}>
                {result.imagePath ? (
                  <img alt={`${result.hookTitle} 광고 시안`} src={result.imagePath} />
                ) : (
                  <div className={styles.resultPending}>
                    {result.status === "error" ? result.errorMessage : "생성 중"}
                  </div>
                )}
                <b>{result.hookTitle}</b>
                <span>{layoutLabels[result.plan.layoutType]}</span>
                {result.status === "success" ? (
                  <button onClick={() => props.onUseResult(result)} type="button">
                    이 시안 사용
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

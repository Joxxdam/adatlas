"use client";

import { useState } from "react";
import type { GeneratedAdCopy, ProductImageRenderEffect } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

type CanvasElement = "headline" | "bodyCopy" | "product" | "bottomBarCopy" | "cta";

const regions: Array<{ id: CanvasElement; label: string; top: string; height: string }> = [
  { id: "headline", label: "헤드라인", top: "2%", height: "20%" },
  { id: "bodyCopy", label: "본문", top: "22%", height: "15%" },
  { id: "product", label: "상품", top: "37%", height: "43%" },
  { id: "bottomBarCopy", label: "하단 문구", top: "80%", height: "11%" },
  { id: "cta", label: "CTA", top: "91%", height: "8%" },
];

export function CanvasPreview(props: { imagePath: string; copy: GeneratedAdCopy; productEffect: ProductImageRenderEffect; onCopyChange: (copy: GeneratedAdCopy) => void; onProductEffectChange: (effect: ProductImageRenderEffect) => void; onRender: () => void }) {
  const [selected, setSelected] = useState<CanvasElement>("headline");
  const isText = selected !== "product";

  const nudge = (x: number, y: number) => {
    props.onProductEffectChange({
      ...props.productEffect,
      productOffsetX: props.productEffect.productOffsetX + x,
      productOffsetY: props.productEffect.productOffsetY + y,
    });
  };

  return (
    <div className={styles.canvasShell}>
      <div className={styles.canvasStage}>
        <img alt="생성된 광고 배너" src={props.imagePath} />
        {regions.map((region) => (
          <button aria-label={`${region.label} 선택`} className={`${styles.canvasRegion} ${selected === region.id ? styles.canvasRegionSelected : ""}`} key={region.id} onClick={() => setSelected(region.id)} style={{ top: region.top, height: region.height }} type="button">
            <span>{region.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.canvasToolbar}>
        <strong>{regions.find((region) => region.id === selected)?.label}</strong>
        {isText ? (
          <input aria-label="선택 문구 빠른 수정" onChange={(event) => props.onCopyChange({ ...props.copy, [selected]: event.target.value })} value={String(props.copy[selected] || "")} />
        ) : (
          <>
            <button onClick={() => nudge(-12, 0)} title="왼쪽" type="button">
              ←
            </button>
            <button onClick={() => nudge(0, -12)} title="위" type="button">
              ↑
            </button>
            <button onClick={() => nudge(0, 12)} title="아래" type="button">
              ↓
            </button>
            <button onClick={() => nudge(12, 0)} title="오른쪽" type="button">
              →
            </button>
          </>
        )}
        <button onClick={props.onRender} type="button">
          반영
        </button>
      </div>
    </div>
  );
}

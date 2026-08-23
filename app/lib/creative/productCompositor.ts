import type { ProductImageRenderEffect } from "../mvp/types";
import type { ProductArrangement } from "./types";

export type ProductLayerPlan = {
  imagePaths: string[];
  arrangement: ProductArrangement;
  effect: ProductImageRenderEffect;
  preserveIdentity: true;
  warnings: string[];
};

export function buildProductLayerPlan(params: { imagePaths: string[]; arrangement: ProductArrangement; effect: ProductImageRenderEffect }): ProductLayerPlan {
  const paths = Array.from(new Set(params.imagePaths.filter(Boolean))).slice(0, 4);
  const warnings: string[] = [];
  if (!paths.length) warnings.push("실제 상품 이미지가 없어 장면 위에 합성할 상품 레이어가 없습니다.");
  if (paths.length < params.arrangement.count) {
    warnings.push("요청된 상품 개수보다 실제 이미지가 적어 같은 원본을 반복 배치할 수 있습니다.");
  }
  return {
    imagePaths: paths,
    arrangement: params.arrangement,
    effect: params.effect,
    preserveIdentity: true,
    warnings,
  };
}

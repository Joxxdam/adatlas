import type { ProductImageState, ProductInfoForPrompt, SelectedAdImageSource, SelectedAdImageState, SourceImageSelectionState } from "./types";

export type ResolveCurrentProductImagePathsInput = {
  selectedAdImages?: SelectedAdImageState;
  productInfo: ProductInfoForPrompt;
  sourceImageSelection?: SourceImageSelectionState;
  selectedSourceImagePath?: string;
  productImageState?: ProductImageState;
  uploadedMainImageDataUrl?: string;
  gptMainImagePath?: string;
  backgroundImagePath?: string;
};

export type ResolvedProductImagePaths = {
  productImagePaths: string[];
  productImagePath: string;
  secondaryProductImagePath?: string;
  source: SelectedAdImageSource;
};

export function compactUniqueImagePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const path = value?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }

  return result;
}

function output(paths: string[], source: SelectedAdImageSource): ResolvedProductImagePaths {
  const productImagePaths = compactUniqueImagePaths(paths).slice(0, 4);

  return {
    productImagePaths,
    productImagePath: productImagePaths[0] || "",
    secondaryProductImagePath: productImagePaths[1] || "",
    source,
  };
}

function outputWithoutSelectedBackground(paths: string[], source: SelectedAdImageSource, backgroundImagePath?: string) {
  const normalized = compactUniqueImagePaths(paths);
  const productOnly = backgroundImagePath ? normalized.filter((path) => path !== backgroundImagePath) : normalized;
  return output(productOnly.length ? productOnly : normalized, source);
}

function resolveProductImageStatePath(productImageState?: ProductImageState) {
  if (!productImageState) return "";

  if (productImageState.selectedImageMode === "styled-cutout" && productImageState.styledCutoutImagePath) {
    return productImageState.styledCutoutImagePath;
  }

  if (productImageState.selectedImageMode === "cutout" && productImageState.cutoutImagePath) {
    return productImageState.cutoutImagePath;
  }

  return productImageState.originalImagePath || "";
}

function resolveSelectedProcessedProductPath(productImageState?: ProductImageState) {
  if (!productImageState || productImageState.selectedImageMode === "original") return "";
  return resolveProductImageStatePath(productImageState);
}

export function resolveCurrentProductImagePaths(input: ResolveCurrentProductImagePathsInput): ResolvedProductImagePaths {
  const { selectedAdImages, productInfo, sourceImageSelection, selectedSourceImagePath, productImageState, uploadedMainImageDataUrl, gptMainImagePath, backgroundImagePath } = input;

  const selectedProcessedProductPath = resolveSelectedProcessedProductPath(productImageState);
  if (selectedProcessedProductPath) {
    const selectedPaths = selectedAdImages?.selectedImagePaths || [];
    const secondaryPaths = selectedPaths.filter((imagePath) => imagePath !== productImageState?.originalImagePath);
    return outputWithoutSelectedBackground([selectedProcessedProductPath, ...secondaryPaths], selectedAdImages?.source || "product", backgroundImagePath);
  }

  if (selectedAdImages?.selectedImagePaths.length) {
    return outputWithoutSelectedBackground(selectedAdImages.selectedImagePaths, selectedAdImages.source || "detail", backgroundImagePath);
  }

  if (uploadedMainImageDataUrl) {
    return output([uploadedMainImageDataUrl], "upload");
  }

  if (gptMainImagePath) {
    return output([gptMainImagePath], "gpt");
  }

  const selectedCandidatePath = sourceImageSelection?.selectedSourceImagePath || selectedSourceImagePath || "";
  if (selectedCandidatePath) {
    return output([selectedCandidatePath], "detail");
  }

  if (productInfo.productImagePaths?.length) {
    return outputWithoutSelectedBackground(productInfo.productImagePaths, "product", backgroundImagePath);
  }

  const productInfoPaths = compactUniqueImagePaths([productInfo.productImagePath, productInfo.secondaryProductImagePath]);
  if (productInfoPaths.length) {
    return output(productInfoPaths, "product");
  }

  if (productInfo.selectedSourceImagePath) {
    return output([productInfo.selectedSourceImagePath], "detail");
  }

  const productStateImagePath = resolveProductImageStatePath(productImageState);
  if (productStateImagePath || productImageState?.originalImagePath) {
    return output(compactUniqueImagePaths([productStateImagePath, productImageState?.originalImagePath]), "product");
  }

  if (backgroundImagePath) {
    return output([backgroundImagePath], "background");
  }

  return output([], "unknown");
}

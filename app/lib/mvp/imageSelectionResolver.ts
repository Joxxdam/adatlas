import type {
  ProductImageState,
  ProductInfoForPrompt,
  SelectedAdImageSource,
  SelectedAdImageState,
  SourceImageSelectionState,
} from "./types";

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

function resolveProductImageStatePath(productImageState?: ProductImageState) {
  if (!productImageState) return "";

  if (
    productImageState.selectedImageMode === "styled-cutout" &&
    productImageState.styledCutoutImagePath
  ) {
    return productImageState.styledCutoutImagePath;
  }

  if (productImageState.selectedImageMode === "cutout" && productImageState.cutoutImagePath) {
    return productImageState.cutoutImagePath;
  }

  return productImageState.originalImagePath || "";
}

export function resolveCurrentProductImagePaths(
  input: ResolveCurrentProductImagePathsInput
): ResolvedProductImagePaths {
  const {
    selectedAdImages,
    productInfo,
    sourceImageSelection,
    selectedSourceImagePath,
    productImageState,
    uploadedMainImageDataUrl,
    gptMainImagePath,
    backgroundImagePath,
  } = input;

  if (selectedAdImages?.selectedImagePaths.length) {
    return output(selectedAdImages.selectedImagePaths, selectedAdImages.source || "detail");
  }

  if (uploadedMainImageDataUrl) {
    return output([uploadedMainImageDataUrl], "upload");
  }

  if (gptMainImagePath) {
    return output([gptMainImagePath], "gpt");
  }

  const selectedCandidatePath =
    sourceImageSelection?.selectedSourceImagePath || selectedSourceImagePath || "";
  if (selectedCandidatePath) {
    return output([selectedCandidatePath], "detail");
  }

  if (productInfo.productImagePaths?.length) {
    return output(productInfo.productImagePaths, "product");
  }

  const productInfoPaths = compactUniqueImagePaths([
    productInfo.productImagePath,
    productInfo.secondaryProductImagePath,
  ]);
  if (productInfoPaths.length) {
    return output(productInfoPaths, "product");
  }

  if (productInfo.selectedSourceImagePath) {
    return output([productInfo.selectedSourceImagePath], "detail");
  }

  const selectedProcessedProductPath = resolveProductImageStatePath(productImageState);
  if (selectedProcessedProductPath || productImageState?.originalImagePath) {
    return output(
      compactUniqueImagePaths([selectedProcessedProductPath, productImageState?.originalImagePath]),
      "product"
    );
  }

  if (backgroundImagePath) {
    return output([backgroundImagePath], "background");
  }

  return output([], "unknown");
}

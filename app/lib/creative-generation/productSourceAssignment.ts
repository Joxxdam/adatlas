import type {
  GenerationJob,
  NativeProductSourceAssignment,
  NativeProductSourceKind,
  ProductReferenceImage,
  ProductReferenceRole,
} from "./types.ts";
import type { NativeReferenceProductForm, NativeReferenceProductPresentation } from "./referenceLibraryManagement.ts";

type ProductSourceReference = {
  id: string;
  productForm?: NativeReferenceProductForm;
  productPresentation?: NativeReferenceProductPresentation;
  supportsPackagedProduct?: boolean;
  supportsNaturalFood?: boolean;
};

const forbiddenCutoutPattern = /(?:^|[\\/_.-])(?:processed-products|product-cutouts?|remove-?bg|cutout|nukki|누끼)(?:[\\/_.-]|$)/iu;
const cookedSourcePattern = /(?:조리\s*(?:완성|후|된|장면)|구운|구워진|섭취\s*장면|레시피|플레이팅|serving|served|recipe|cooked|grilled|seared|fried)/iu;
const packageSignalPattern = /(?:포장|패키지|라벨|용기|보틀|병|캔|파우치|봉지|트레이|박스|상자|package|label|bottle|can|pouch|tray|box)/iu;
const packagedForms = new Set<NativeReferenceProductForm>(["bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot"]);
const packageRoles = new Set<ProductReferenceRole>(["front-package", "side-package", "back-package"]);
const packagedRepresentations = new Set(["packaged-product", "product-package-group", "bundle-components", "multi-unit-set"]);
const unpackagedRepresentations = new Set(["irregular-product", "single-product"]);

export function resolveNativeReferenceProductPresentation(reference: ProductSourceReference): NativeReferenceProductPresentation {
  if (reference.productPresentation) return reference.productPresentation;
  if (reference.supportsPackagedProduct && reference.supportsNaturalFood) return "mixed";
  if (reference.supportsPackagedProduct || (reference.productForm && packagedForms.has(reference.productForm))) return "packaged";
  return "unpackaged";
}

function sourceCandidate(job: GenerationJob, image: ProductReferenceImage) {
  return job.productTruth.product.sourceImageCandidates?.find((candidate) => candidate.imagePath === image.url);
}

/** 조리 사진은 결과 장면의 증거로 쓰지 않고, 판매 원물에서 자연스럽게 생성합니다. */
export function isCookedProductSource(job: GenerationJob, image: ProductReferenceImage) {
  if (image.role === "cooked") return true;
  const candidate = sourceCandidate(job, image);
  if (candidate?.expectedRepresentationType === "plated-product") return true;
  return cookedSourcePattern.test([image.url, image.description, candidate?.label, candidate?.analysisReason, ...(candidate?.warnings || [])].filter(Boolean).join(" "));
}

function classifyProductSource(job: GenerationJob, image: ProductReferenceImage): NativeProductSourceKind | undefined {
  if (!image.usableForGeneration || image.duplicateOf || image.watermarkRisk || forbiddenCutoutPattern.test(image.url) || isCookedProductSource(job, image)) return undefined;
  const candidate = sourceCandidate(job, image);
  const representation = candidate?.expectedRepresentationType;
  const signals = [
    image.url,
    image.description,
    candidate?.label,
    candidate?.analysisReason,
    ...(candidate?.warnings || []),
  ].filter(Boolean).join(" ");
  const detectedPackage = candidate?.detectedObjects?.some((object) => object.role === "package" && object.selected !== false);

  if (packageRoles.has(image.role) || detectedPackage || (representation && packagedRepresentations.has(representation)) || candidate?.expectedExtractionScope === "product-and-package") {
    return "packaged";
  }
  if (representation && unpackagedRepresentations.has(representation)) return "unpackaged";
  if (image.role === "product-detail" || image.role === "texture" || image.role === "ingredient") return "unpackaged";

  const productText = [
    job.productTruth.product.category,
    job.productTruth.product.detectedProductType,
    job.productTruth.normalized.cleanProductName,
    job.productReferenceProfile?.immutableFacts.packageType,
  ].filter(Boolean).join(" ");
  const naturalProduct = /(?:육류|고기|한우|소고기|돼지고기|과일|채소|농산|수산|meat|beef|pork|fruit|produce)/iu.test(productText);
  if (naturalProduct && !packageSignalPattern.test(signals)) return "unpackaged";
  if (image.hasText || packageSignalPattern.test(signals) || job.productReferenceProfile?.immutableFacts.packageType) return "packaged";
  return "unpackaged";
}

function sourceScore(job: GenerationJob, image: ProductReferenceImage, kind: NativeProductSourceKind) {
  const candidate = sourceCandidate(job, image);
  const minDimension = Math.min(image.width || candidate?.width || 0, image.height || candidate?.height || 0);
  const roleScore = kind === "packaged"
    ? image.role === "front-package" ? 500 : image.role === "primary-product" ? 460 : packageRoles.has(image.role) ? 400 : 260
    : image.role === "primary-product" ? 500 : image.role === "product-detail" ? 440 : image.role === "texture" ? 390 : 320;
  const resolutionScore = minDimension >= 1000 ? 90 : minDimension >= 700 ? 60 : minDimension >= 400 ? 25 : 0;
  const labelScore = kind === "packaged" && image.hasText ? 35 : 0;
  return roleScore + image.importance + resolutionScore + labelScore + Number(candidate?.salesUnitMatchScore || 0);
}

function availableSources(job: GenerationJob) {
  const sources = (job.productReferenceProfile?.referenceImages || [])
    .map((image) => ({ image, kind: classifyProductSource(job, image) }))
    .filter((entry): entry is { image: ProductReferenceImage; kind: NativeProductSourceKind } => Boolean(entry.kind));
  const unique = sources.filter((entry, index, all) => all.findIndex((other) => other.image.url === entry.image.url) === index);
  return {
    packaged: unique.filter((entry) => entry.kind === "packaged").sort((left, right) => sourceScore(job, right.image, "packaged") - sourceScore(job, left.image, "packaged")),
    unpackaged: unique.filter((entry) => entry.kind === "unpackaged").sort((left, right) => sourceScore(job, right.image, "unpackaged") - sourceScore(job, left.image, "unpackaged")),
  };
}

function toAssignment(entry: { image: ProductReferenceImage; kind: NativeProductSourceKind }, reference: ProductSourceReference): NativeProductSourceAssignment {
  return {
    kind: entry.kind,
    imageId: entry.image.id,
    sourcePath: entry.image.url,
    sourceRole: entry.image.role,
    protectPhysicalLabel: entry.kind === "packaged",
    reason: entry.kind === "packaged"
      ? `레퍼런스 ${reference.id}의 포장 상품 자리에 사용할 실제 라벨 포함 원본 1장`
      : `레퍼런스 ${reference.id}의 비포장·조리 장면을 만들 판매 원물 원본 1장`,
  };
}

/**
 * 한 광고 레퍼런스에는 한 상품 앵커만 배정합니다. 레퍼런스에 포장과
 * 비포장 표현이 실제로 함께 있을 때만 각각 한 장씩, 최대 두 장을 배정합니다.
 */
export function assignNativeProductSources(job: GenerationJob, references: readonly ProductSourceReference[]): NativeProductSourceAssignment[][] {
  const pools = availableSources(job);
  if (!pools.packaged.length && !pools.unpackaged.length) {
    throw new Error("AI 광고 제작에 사용할 비가공 상세페이지 상품 원본을 찾지 못했습니다.");
  }
  return references.map((reference, index) => {
    const presentation = resolveNativeReferenceProductPresentation(reference);
    const wantedKinds: NativeProductSourceKind[] = presentation === "mixed"
      ? ["packaged", "unpackaged"]
      : [presentation];
    const assignments = wantedKinds.flatMap((kind) => {
      const pool = pools[kind];
      if (!pool.length) return [];
      return [toAssignment(pool[index % pool.length], reference)];
    });
    if (assignments.length) return assignments;

    // 현재 상품에 한 표현만 존재하는 경우 다른 상품이나 조리 사진을 만들지
    // 않고, 검증된 유일한 표현 한 장으로 안전하게 축소합니다.
    const fallbackPool = pools.packaged.length ? pools.packaged : pools.unpackaged;
    return [toAssignment(fallbackPool[index % fallbackPool.length], reference)];
  });
}

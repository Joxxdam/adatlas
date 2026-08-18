import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createBrandCode,
  createProductCode,
  createHookVariantAssetCode,
  createExplorationAssetCode,
  extensionFromImageUrl,
  extractCreativeAssetCode,
  generateCreativeAssetCode,
  getHookCode,
  validateCreativeAssetCode,
} from "./code.ts";
import { createExperimentAssetCode } from "../hook-experiments/codes.ts";
import type {
  CreateCreativeAssetInput,
  CreativeAsset,
  CreativeAssetFilters,
  CreativeAssetMatchResult,
  CreativeAssetStatus,
} from "./types.ts";

type CreativeAssetStore = {
  version: "creative-assets-v1";
  assets: CreativeAsset[];
  entityCodes: {
    brands: Record<string, string>;
    products: Record<string, string>;
  };
};

const emptyStore = (): CreativeAssetStore => ({
  version: "creative-assets-v1",
  assets: [],
  entityCodes: { brands: {}, products: {} },
});

function normalizedText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function entityId(kind: "brand" | "product", id: string | undefined, name: string) {
  if (normalizedText(id)) return normalizedText(id);
  const hash = crypto.createHash("sha256").update(`${kind}|${name || "unknown"}`).digest("hex").slice(0, 16);
  return `${kind}-${hash}`;
}

function uniqueEntityCode(base: string, key: string, codes: Record<string, string>) {
  const occupied = new Set(Object.entries(codes).filter(([entry]) => entry !== key).map(([, code]) => code));
  if (!occupied.has(base)) return base;
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const suffix = crypto.createHash("sha256").update(`${key}|${attempt}`).digest("hex").slice(0, 2).toUpperCase();
    const candidate = `${base.slice(0, 3)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("브랜드 또는 상품의 고정 코드를 만들지 못했습니다.");
}

function secureUnique() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(4), (value) => alphabet[value % alphabet.length]).join("");
}

function sortNewest(assets: CreativeAsset[]) {
  return [...assets].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createCreativeAssetRepository(options: { dataDirectory?: string } = {}) {
  const dataDirectory = options.dataDirectory || path.join(process.cwd(), "data", "creative-assets");
  const storePath = path.join(dataDirectory, "assets.json");
  let queue: Promise<void> = Promise.resolve();

  async function readStore() {
    try {
      const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<CreativeAssetStore>;
      return {
        ...emptyStore(),
        ...parsed,
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        entityCodes: {
          brands: parsed.entityCodes?.brands || {},
          products: parsed.entityCodes?.products || {},
        },
      } satisfies CreativeAssetStore;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw new Error("저장된 소재 기록을 불러오지 못했습니다.");
    }
  }

  async function writeStore(store: CreativeAssetStore) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporary, storePath);
  }

  function locked<T>(operation: () => Promise<T>) {
    const next = queue.then(operation, operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  function resolveCodes(store: CreativeAssetStore, input: CreateCreativeAssetInput) {
    const brandName = normalizedText(input.brandName, "브랜드 미지정");
    const productName = normalizedText(input.productName, "상품 미지정");
    const brandId = entityId("brand", input.brandId, brandName);
    const productId = entityId("product", input.productId, productName);
    const brandCode =
      store.entityCodes.brands[brandId] ||
      uniqueEntityCode(createBrandCode(brandName, brandId), brandId, store.entityCodes.brands);
    const productCode =
      store.entityCodes.products[productId] ||
      uniqueEntityCode(createProductCode(productName, productId), productId, store.entityCodes.products);
    store.entityCodes.brands[brandId] = brandCode;
    store.entityCodes.products[productId] = productCode;
    return { brandId, brandName, brandCode, productId, productName, productCode };
  }

  return {
    async create(input: CreateCreativeAssetInput) {
      return locked(async () => {
        const store = await readStore();
        const requestKey = normalizedText(input.generationRequestKey);
        if (requestKey) {
          const existing = store.assets.find((asset) => asset.generationRequestKey === requestKey);
          if (existing) return { asset: existing, created: false };
        }
        const entities = resolveCodes(store, input);
        const parentCode = normalizedText(input.parentAssetCode);
        const parent = parentCode
          ? store.assets.find((asset) => asset.assetCode === parentCode)
          : undefined;
        if (parentCode && !parent) throw new Error("이전 버전 소재를 찾지 못해 수정본을 저장할 수 없습니다.");
        const createdAt = new Date(input.createdAt || Date.now());
        if (Number.isNaN(createdAt.getTime())) throw new Error("소재 생성 날짜가 올바르지 않습니다.");
        const hookCode = getHookCode(input.hookType || "");
        const version = parent ? parent.version + 1 : 1;
        let assetCode = "";
        if (input.explorationCode && input.hookVariantCode && input.conceptCode) {
          for (let nextVersion = version; nextVersion < 100; nextVersion += 1) {
            const candidate = createExplorationAssetCode({
              brandCode: entities.brandCode,
              productCode: entities.productCode,
              explorationCode: input.explorationCode,
              hookVariantCode: input.hookVariantCode,
              conceptCode: input.conceptCode,
              version: nextVersion,
            });
            if (!store.assets.some((asset) => asset.assetCode === candidate)) {
              assetCode = candidate;
              break;
            }
          }
        } else if (input.experimentId && input.originalHostProductNo && input.generationRound && input.variant) {
          const candidate = createExperimentAssetCode({
            brandCode: entities.brandCode,
            originalHostProductNo: input.originalHostProductNo,
            hookCode: hookCode === "ETC" ? "CTL" : hookCode,
            generationRound: input.generationRound,
            variant: input.variant,
            version,
          });
          if (store.assets.some((asset) => asset.assetCode === candidate)) {
            throw new Error("같은 실험 회차와 변형의 소재코드가 이미 존재합니다.");
          }
          assetCode = candidate;
        } else if (input.testCode && input.hookVariantCode) {
          const base = createHookVariantAssetCode({
            brandCode: entities.brandCode,
            productCode: entities.productCode,
            testCode: input.testCode,
            hookVariantCode: input.hookVariantCode,
          });
          if (!store.assets.some((asset) => asset.assetCode === base)) {
            assetCode = base;
          } else {
            for (let nextVersion = 2; nextVersion < 100; nextVersion += 1) {
              const candidate = createHookVariantAssetCode({
                brandCode: entities.brandCode,
                productCode: entities.productCode,
                testCode: input.testCode,
                hookVariantCode: input.hookVariantCode,
                version: nextVersion,
              });
              if (!store.assets.some((asset) => asset.assetCode === candidate)) {
                assetCode = candidate;
                break;
              }
            }
          }
        } else {
          for (let attempt = 0; attempt < 64; attempt += 1) {
            const candidate = generateCreativeAssetCode({
              brandCode: entities.brandCode,
              productCode: entities.productCode,
              hookCode,
              createdAt,
              unique: secureUnique(),
            });
            if (!store.assets.some((asset) => asset.assetCode === candidate)) {
              assetCode = candidate;
              break;
            }
          }
        }
        if (!assetCode) throw new Error("중복되지 않는 소재코드를 발급하지 못했습니다. 다시 시도해 주세요.");
        const generatedImageUrl = normalizedText(input.generatedImageUrl);
        if (!generatedImageUrl) throw new Error("생성된 이미지 경로가 없어 소재를 저장할 수 없습니다.");
        const now = createdAt.toISOString();
        const asset: CreativeAsset = {
          id: crypto.randomUUID(),
          assetCode,
          ...entities,
          originalHostProductNo: normalizedText(input.originalHostProductNo) || undefined,
          advertiserId: normalizedText(input.advertiserId) || undefined,
          opportunityId: normalizedText(input.opportunityId) || undefined,
          analysisRunId: normalizedText(input.analysisRunId) || undefined,
          opportunityType: normalizedText(input.opportunityType) || undefined,
          recommendedHookType: normalizedText(input.recommendedHookType) || undefined,
          appliedContentNoteIds: Array.from(new Set(input.appliedContentNoteIds || [])).filter(Boolean),
          reviewInsightIds: Array.from(new Set(input.reviewInsightIds || [])).filter(Boolean),
          category: normalizedText(input.category, "기타"),
          hookType: normalizedText(input.hookType, "기타"),
          hookCode,
          mainMessage: normalizedText(input.mainMessage) || undefined,
          visualDirection: normalizedText(input.visualDirection) || undefined,
          generationRound: input.generationRound,
          variant: normalizedText(input.variant) || undefined,
          experimentId: normalizedText(input.experimentId) || undefined,
          testCode: normalizedText(input.testCode) || undefined,
          hookVariantCode: normalizedText(input.hookVariantCode) || undefined,
          explorationCode: normalizedText(input.explorationCode) || undefined,
          conceptCode: normalizedText(input.conceptCode) || undefined,
          primaryHookTag: normalizedText(input.primaryHookTag) || undefined,
          secondaryHookTags: Array.from(new Set(input.secondaryHookTags || [])).filter(Boolean),
          customerReason: normalizedText(input.customerReason) || undefined,
          hypothesisId: normalizedText(input.hypothesisId) || undefined,
          advertisingHypothesis: normalizedText(input.advertisingHypothesis),
          headline: normalizedText(input.headline),
          subCopy: normalizedText(input.subCopy),
          benefitCopy: normalizedText(input.benefitCopy),
          templateId: normalizedText(input.templateId, "unknown-template"),
          layoutType: normalizedText(input.layoutType || input.templateId, "unknown-layout"),
          backgroundType: normalizedText(input.backgroundType, "unknown"),
          backgroundId: normalizedText(input.backgroundId) || undefined,
          sourceProductImage: normalizedText(input.sourceProductImage),
          generatedImageUrl,
          fileName: `${assetCode}.${extensionFromImageUrl(generatedImageUrl)}`,
          recommendedAdName: assetCode,
          utmContent: `utm_content=${assetCode}`,
          objective: normalizedText(input.objective, input.experimentId ? "" : "purchase"),
          status: "generated",
          version,
          parentAssetCode: parent?.assetCode,
          generationRequestKey: requestKey || undefined,
          createdAt: now,
          updatedAt: now,
        };
        store.assets.push(asset);
        await writeStore(store).catch(() => {
          throw new Error("소재 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        });
        return { asset, created: true };
      });
    },

    async getByCode(assetCode: string) {
      if (!validateCreativeAssetCode(assetCode)) return null;
      return (await readStore()).assets.find((asset) => asset.assetCode === assetCode) || null;
    },

    async getById(id: string) {
      return (await readStore()).assets.find((asset) => asset.id === id) || null;
    },

    async getByGenerationRequestKey(requestKey: string) {
      const normalized = normalizedText(requestKey);
      if (!normalized) return null;
      return (await readStore()).assets.find((asset) => asset.generationRequestKey === normalized) || null;
    },

    async list(filters: CreativeAssetFilters = {}) {
      const query = normalizedText(filters.query).toLowerCase();
      const assetCode = normalizedText(filters.assetCode).toUpperCase();
      const brand = normalizedText(filters.brand).toLowerCase();
      const product = normalizedText(filters.product).toLowerCase();
      const hook = normalizedText(filters.hook).toLowerCase();
      const dateFrom = normalizedText(filters.dateFrom);
      const dateTo = normalizedText(filters.dateTo);
      const filtered = sortNewest((await readStore()).assets).filter((asset) => {
        const haystack = [asset.assetCode, asset.brandName, asset.productName, asset.hookType, asset.hookCode]
          .join(" ")
          .toLowerCase();
        return (
          (!query || haystack.includes(query)) &&
          (!assetCode || asset.assetCode.includes(assetCode)) &&
          (!brand || asset.brandName.toLowerCase().includes(brand)) &&
          (!product || asset.productName.toLowerCase().includes(product)) &&
          (!hook || asset.hookType.toLowerCase().includes(hook) || asset.hookCode.toLowerCase() === hook) &&
          (!dateFrom || asset.createdAt.slice(0, 10) >= dateFrom) &&
          (!dateTo || asset.createdAt.slice(0, 10) <= dateTo) &&
          (!filters.status || asset.status === filters.status)
        );
      });
      return filtered.slice(0, Math.max(1, Math.min(500, filters.limit || 100)));
    },

    async updateStatus(assetCode: string, status: CreativeAssetStatus) {
      return locked(async () => {
        const store = await readStore();
        const index = store.assets.findIndex((asset) => asset.assetCode === assetCode);
        if (index < 0) throw new Error("소재를 찾지 못했습니다.");
        store.assets[index] = { ...store.assets[index], status, updatedAt: new Date().toISOString() };
        await writeStore(store);
        return store.assets[index];
      });
    },

    async matchFromText(value: string): Promise<CreativeAssetMatchResult> {
      const assetCode = extractCreativeAssetCode(value);
      if (!assetCode) return { status: "needs-review", reason: "code-missing" };
      const matches = (await readStore()).assets.filter((asset) => asset.assetCode === assetCode);
      if (!matches.length) return { status: "not-found", assetCode, reason: "소재코드에 해당하는 소재가 없습니다." };
      if (matches.length > 1) return { status: "needs-review", assetCode, reason: "duplicate-code" };
      return { status: "matched", assetCode, asset: matches[0], matchType: "exact-code" };
    },
  };
}

export const creativeAssetRepository = createCreativeAssetRepository();

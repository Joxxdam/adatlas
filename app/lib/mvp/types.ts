export type MvpBrand = {
  id: string;
  brandName: string;
  category: string;
  metaLibraryUrl: string;
  tiktokUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CollectedAdImage = {
  id: string;
  brandName: string;
  sourcePlatform: "Meta" | "TikTok" | "Manual";
  imageUrl: string;
  localImagePath?: string;
  originalAdUrl?: string;
  collectedAt: string;
  analysis?: ImageAnalysis;
};

export type ImageAnalysis = {
  extractedText: string;
  hookType: string;
  appealPoint: string;
  designTone: string;
  hasCta: boolean;
  categoryTags: string[];
  analyzedAt: string;
};

export type GeneratedAdImage = {
  id: string;
  sourceWebsiteUrl: string;
  productName: string;
  price: string;
  description: string;
  referenceImageId?: string;
  dataUrl: string;
  createdAt: string;
};

export type CollectionStatus = {
  totalBrands: number;
  completedBrands: number;
  collectedImages: number;
  failedBrands: number;
  failures: { brandName: string; error: string }[];
};

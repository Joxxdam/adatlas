export const categoryCreativeStyles = ["auto", "editorial", "practical", "seasonal", "friendly"] as const;
export type CategoryCreativeStyle = (typeof categoryCreativeStyles)[number];

export type CategoryCreativeSource = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  categoryId: string;
  categoryName: string;
  productName: string;
  originalFileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  fileName: string;
  sourceType?: "upload" | "automatic";
  imageSource?: "product-page" | "candidate-thumbnail";
  productUrl?: string;
  originalImageUrl?: string;
  createdAt: string;
};

export type CategoryCreativeCopy = { headline: string; subheadline: string; cta: string };

export type CategoryCreativeJob = {
  id: string;
  kind: "category-creative";
  status: "generating" | "completed" | "failed";
  advertiserId: string;
  advertiserName: string;
  categoryId: string;
  categoryName: string;
  style: CategoryCreativeStyle;
  sourceIds: string[];
  representativeSourceId: string;
  copy: CategoryCreativeCopy;
  palette: { background: string; backgroundAlt: string; text: string; accent: string };
  conceptId: string;
  conceptSummary: string;
  referenceProfile: "fashion-editorial-v1";
  outputs: {
    square: { width: 1200; height: 1200; fileName: string; baseFileName: string };
    vertical: { width: 1080; height: 1920; fileName: string; baseFileName: string };
  } | null;
  qa: Array<{ code: string; level: "pass" | "warning" | "fail"; message: string }>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

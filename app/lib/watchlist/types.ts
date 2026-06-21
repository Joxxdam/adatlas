export type WatchlistBrand = {
  id: string;
  priority: "A" | "B" | string;
  category: string;
  brand: string;
  country: string;
  referenceStrength: string;
  hookPattern: string;
  keyword: string;
  urls: {
    meta?: string;
    tiktok?: string;
    google?: string;
    website?: string;
  };
  memo: string;
  enabled: boolean;
};

export type CrawledContent = {
  brandId: string;
  brand: string;
  source: "meta" | "tiktok" | "google" | "website" | "watchlist";
  url?: string;
  title?: string;
  description?: string;
  text: string;
  mediaUrls: string[];
  fetchedAt: string;
  ok: boolean;
  error?: string;
};

export type ContentAnalysis = {
  id: string;
  brandId: string;
  brand: string;
  category: string;
  priority: string;
  source: CrawledContent["source"];
  sourceUrl?: string;
  mediaUrls: string[];
  hook: string;
  usp: string[];
  cta: string[];
  frames: string[];
  emotion: string[];
  contentType: string;
  copyScore: number;
  uspScore: number;
  trendScore: number;
  improvementSuggestions: string[];
  rawText: string;
  analyzedAt: string;
};

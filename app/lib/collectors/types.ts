export type CollectorSource = "meta" | "tiktok" | "pinterest";

export type CollectRequest = {
  source: CollectorSource;
  query: string;
  country: string;
  fromDate: string;
  toDate: string;
  limit?: number;
};

export type CollectedReference = {
  id: string;
  source: CollectorSource;
  platform: string;
  externalId: string;
  title: string;
  brand: string;
  body?: string;
  landingUrl?: string;
  mediaUrls: string[];
  thumbnailUrl?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  raw: unknown;
  collectedAt: string;
};

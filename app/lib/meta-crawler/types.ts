export type MetaAdCard = {
  brandName: string;
  adText: string;
  imageUrl?: string;
  videoThumbnailUrl?: string;
  landingUrl?: string;
  adSnapshotUrl?: string;
  startedAt?: string;
  crawledAt: string;
};

export type MetaCrawlRequest = {
  brandName: string;
  metaLibraryUrl: string;
  limit?: number;
};

export type MetaCrawlResult = {
  brandName: string;
  metaLibraryUrl: string;
  limit: number;
  count: number;
  ads: MetaAdCard[];
  warnings: string[];
  crawledAt: string;
};

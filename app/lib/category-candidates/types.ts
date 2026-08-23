export type CategoryTrendStatus = "rising" | "turning-up" | "stable" | "falling" | "decline-easing" | "insufficient";

export type CategoryMetricRow = {
  productName: string;
  current7Sales: number;
  previous7Sales: number;
  current7Orders: number;
  previous7Orders: number;
  weeklySales: [number, number, number, number];
  weeklyOrders: [number, number, number, number];
};

export type CategoryCandidate = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  categoryId: string;
  categoryName: string;
  originalCategorySignals: string[];
  status: CategoryTrendStatus;
  statusLabel: string;
  current7Sales: number;
  previous7Sales: number;
  current7Orders: number;
  previous7Orders: number;
  salesChangeRate: number | null;
  orderChangeRate: number | null;
  weeklySales: [number, number, number, number];
  weeklyOrders: [number, number, number, number];
  activeProductCount: number;
  advertiserSalesShare: number;
  topProductConcentration: number;
  evidenceProducts: string[];
  reason: string;
  peerComparison: { available: boolean; label: string; reason: string };
};

export type CategoryCandidateResponse = {
  advertiser: { id: string; name: string; source: "host24" | "hostmk" };
  candidates: CategoryCandidate[];
  latestDataDate: string;
  processedBytes: number;
  cacheHit: boolean;
  generatedAt: string;
};

"use client";

import { useEffect, useState } from "react";
import type { ProductAnalysisSnapshot } from "../../lib/video-collaboration/types";

export type VideoPlanningPersonOption = {
  name: string;
  role: "designer" | "marketer";
};

export type VideoPlanningProductOption = {
  id: string;
  advertiserName: string;
  productUrl: string;
  productName: string;
  analysis: ProductAnalysisSnapshot;
};

export function useVideoPlanningOptions() {
  const [people, setPeople] = useState<VideoPlanningPersonOption[]>([]);
  const [products, setProducts] = useState<VideoPlanningProductOption[]>([]);

  useEffect(() => {
    fetch("/api/video-projects/options", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "선택지를 불러오지 못했습니다.");
        setPeople(Array.isArray(payload.people) ? payload.people : []);
        setProducts(Array.isArray(payload.products) ? payload.products : []);
      })
      .catch(() => {
        setPeople([]);
        setProducts([]);
      });
  }, []);

  return { people, products };
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const legacyTargets: Record<string, string> = {
  "#advertiser-memory": "/admin/advertisers",
  "#advertiser-settings": "/admin/advertisers",
  "#golden-references": "/admin/references",
  "#image-references": "/admin/references?tab=analysis",
};

export function LegacyAdminAnchorRedirect() {
  const router = useRouter();
  useEffect(() => {
    const target = legacyTargets[window.location.hash];
    if (target) router.replace(target);
  }, [router]);
  return null;
}

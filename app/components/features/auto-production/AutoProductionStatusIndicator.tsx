"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AutoProductionDashboardStatus } from "../../../lib/auto-production/types";

export function AutoProductionStatusIndicator() {
  const [status, setStatus] = useState<AutoProductionDashboardStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const response = await fetch("/api/auto-production/status", { cache: "no-store" });
        const payload = (await response.json()) as { status?: AutoProductionDashboardStatus };
        if (mounted && response.ok) setStatus(payload.status || null);
      } catch {
        // 자동 제작 서버가 꺼진 경우 기존 화면 사용을 막지 않는다.
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!status?.notification) return null;
  return (
    <div className={`auto-production-indicator ${status.notification.level}`} role="status">
      <span>{status.notification.message}</span>
      <Link href={status.notification.href}>{status.activeRunCount ? "진행 보기" : "결과 확인"}</Link>
    </div>
  );
}

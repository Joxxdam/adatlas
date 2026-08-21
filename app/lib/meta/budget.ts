import type { MetaAccount, MetaBudgetResolution } from "./types.ts";

export function resolveMetaDailyBudget(
  account: MetaAccount,
  config: {
    defaultDailyBudgetUsd: number;
    budgetByAccount: Record<string, { currency: string; dailyBudgetMinor: number }>;
  }
): MetaBudgetResolution {
  if (account.currency === "USD") {
    const dailyBudgetMinor = Math.round(config.defaultDailyBudgetUsd * 100);
    if (dailyBudgetMinor !== 500) {
      return {
        ok: false,
        display: "일 예산 설정 오류",
        currency: "USD",
        reason: "USD 일 예산은 현재 승인값 USD 5만 허용합니다.",
      };
    }
    return { ok: true, display: "일 예산 USD 5", currency: "USD", dailyBudgetMinor };
  }
  const approved = config.budgetByAccount[account.id];
  if (!approved) {
    return {
      ok: false,
      display: `${account.currency} 승인 예산 없음`,
      currency: account.currency,
      reason: "비USD 광고 계정은 승인된 계정별 예산 매핑이 필요합니다.",
    };
  }
  if (approved.currency !== account.currency) {
    return {
      ok: false,
      display: "계정 통화 불일치",
      currency: account.currency,
      reason: `예산 매핑 통화 ${approved.currency}와 계정 통화 ${account.currency}가 다릅니다.`,
    };
  }
  if (!Number.isSafeInteger(approved.dailyBudgetMinor) || approved.dailyBudgetMinor <= 0) {
    return {
      ok: false,
      display: "승인 예산 오류",
      currency: account.currency,
      reason: "dailyBudgetMinor는 양의 정수여야 합니다.",
    };
  }
  return {
    ok: true,
    display: `일 예산 ${account.currency} ${approved.dailyBudgetMinor.toLocaleString("ko-KR")}`,
    currency: account.currency,
    dailyBudgetMinor: approved.dailyBudgetMinor,
  };
}

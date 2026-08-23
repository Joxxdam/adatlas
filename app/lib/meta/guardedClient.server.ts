import { assertNoMetaAutomationOptIn } from "./featureOptOutRegistry.ts";
import type { MetaOperation } from "./types.ts";
import type { MetaProvider } from "./provider.server.ts";

const readOperations = new Set<MetaOperation>(["connection", "accounts", "campaigns", "adsets", "ads", "insights"]);
const writeOperations = new Set<MetaOperation>(["media.upload", "adset.create", "creative.create", "ad.create"]);

export function createGuardedMetaClient(input: { provider: MetaProvider; readEnabled: boolean; writeEnabled: boolean; dryRun: boolean }) {
  return {
    async read<T>(operation: MetaOperation, path: string, params?: Record<string, unknown>) {
      if (!readOperations.has(operation)) throw new Error("허용되지 않은 Meta 읽기 작업입니다.");
      if (!input.readEnabled) throw new Error("Meta 읽기가 꺼져 있습니다. 서버에서 META_READ_ENABLED=true를 설정해 주세요.");
      return input.provider.request<T>({ operation, method: "GET", path, params });
    },
    async write<T>(operation: MetaOperation, path: string, params: Record<string, unknown>, options: { userConfirmed: boolean }) {
      if (!writeOperations.has(operation)) throw new Error("허용되지 않은 Meta 쓰기 작업입니다.");
      if (!input.writeEnabled) throw new Error("Meta 쓰기가 서버에서 비활성화되어 있습니다.");
      if (input.dryRun) throw new Error("META_DRY_RUN=true에서는 Meta 쓰기를 실행하지 않습니다.");
      if (!options.userConfirmed) throw new Error("사용자의 최종 등록 확인이 필요합니다.");
      assertNoMetaAutomationOptIn(params);
      return input.provider.request<T>({ operation, method: "POST", path, params });
    },
  };
}

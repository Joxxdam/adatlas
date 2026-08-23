import "server-only";
import type { CreativeGenerationEngine } from "../types.ts";
import type { CreativeGenerationProvider } from "./CreativeGenerationProvider.ts";
import { CodexLocalCreativeProvider } from "./CodexLocalCreativeProvider.server.ts";
import { OpenAIFinalCreativeProvider } from "./OpenAIFinalCreativeProvider.server.ts";

export type CreativeGenerationProviderOptions = {
  explicitPaidApiAuthorization?: boolean;
};

export function createCreativeGenerationProvider(engine: CreativeGenerationEngine = "codex_local", options: CreativeGenerationProviderOptions = {}): CreativeGenerationProvider {
  if (engine !== "openai_api") return new CodexLocalCreativeProvider();
  if (options.explicitPaidApiAuthorization !== true) {
    throw new Error("유료 OpenAI API는 별도 공급자 선택과 작업별 사용 동의를 완료한 경우에만 사용할 수 있습니다. 기본 제작은 Codex·ChatGPT 로그인으로 실행됩니다.");
  }
  return new OpenAIFinalCreativeProvider({ explicitPaidApiAuthorization: true });
}

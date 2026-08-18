import "server-only";
import type { CreativeGenerationEngine } from "../types.ts";
import type { CreativeGenerationProvider } from "./CreativeGenerationProvider.ts";
import { CodexLocalCreativeProvider } from "./CodexLocalCreativeProvider.server.ts";
import { OpenAIFinalCreativeProvider } from "./OpenAIFinalCreativeProvider.server.ts";

export function createCreativeGenerationProvider(engine: CreativeGenerationEngine = "codex_local"): CreativeGenerationProvider {
  return engine === "openai_api" ? new OpenAIFinalCreativeProvider() : new CodexLocalCreativeProvider();
}

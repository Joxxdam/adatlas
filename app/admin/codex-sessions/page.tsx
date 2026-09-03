import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { CodexSessionCleanupWorkspace } from "../../components/codex-sessions/CodexSessionCleanupWorkspace";

export const dynamic = "force-dynamic";

export default function CodexSessionCleanupPage() {
  return (
    <FeaturePageShell activeFeature="codex-sessions">
      <CodexSessionCleanupWorkspace />
    </FeaturePageShell>
  );
}

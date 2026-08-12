import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { HookExperimentWorkspace } from "../components/hook-experiments/HookExperimentWorkspace";

export const dynamic = "force-dynamic";

export default function HookExperimentsPage() {
  return (
    <FeaturePageShell activeFeature="hook-experiments">
      <HookExperimentWorkspace />
    </FeaturePageShell>
  );
}

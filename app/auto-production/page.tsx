import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { AutoProductionWorkspace } from "../components/auto-production/AutoProductionWorkspace";

export const dynamic = "force-dynamic";

export default function AutoProductionPage() {
  return (
    <FeaturePageShell activeFeature="auto-production">
      <AutoProductionWorkspace />
    </FeaturePageShell>
  );
}

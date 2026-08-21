import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { AutoProductionWorkspace } from "../../components/auto-production/AutoProductionWorkspace";
import { LegacyAdminAnchorRedirect } from "../../components/LegacyAdminAnchorRedirect";

export const dynamic = "force-dynamic";

export default function AdminAutoProductionPage() {
  return (
    <FeaturePageShell activeFeature="auto-production">
      <LegacyAdminAnchorRedirect />
      <AutoProductionWorkspace />
    </FeaturePageShell>
  );
}

import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { AdvertiserSettingsWorkspace } from "../../components/meta/AdvertiserSettingsWorkspace";
import { metaRepository } from "../../lib/meta/repository.server";

export const dynamic = "force-dynamic";

export default async function AdvertiserSettingsPage() {
  return (
    <FeaturePageShell activeFeature="advertisers">
      <AdvertiserSettingsWorkspace initialMappings={(await metaRepository.read()).advertiserMappings} />
    </FeaturePageShell>
  );
}

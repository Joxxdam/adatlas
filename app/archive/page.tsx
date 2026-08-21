import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { CreativeArchiveWorkspace } from "../components/creative-archive/CreativeArchiveWorkspace";
import { listCreativeArchiveEntries } from "../lib/creative-archive/service.server";

export const dynamic = "force-dynamic";

export default async function CreativeArchivePage() {
  const entries = await listCreativeArchiveEntries();
  return (
    <FeaturePageShell activeFeature="archive">
      <CreativeArchiveWorkspace initialEntries={entries} />
    </FeaturePageShell>
  );
}

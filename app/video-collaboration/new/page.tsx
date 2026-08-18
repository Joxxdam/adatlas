import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { NewVideoProjectWorkspace } from "../../components/video-collaboration/NewVideoProjectWorkspace";

export default function NewVideoProjectPage() {
  return (
    <FeaturePageShell activeFeature="video-collaboration">
      <NewVideoProjectWorkspace />
    </FeaturePageShell>
  );
}

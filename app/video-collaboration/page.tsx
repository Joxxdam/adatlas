import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { VideoProjectList } from "../components/video-collaboration/VideoProjectList";

export const dynamic = "force-dynamic";

export default function VideoCollaborationPage() {
  return (
    <FeaturePageShell activeFeature="video-collaboration">
      <VideoProjectList />
    </FeaturePageShell>
  );
}

import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { VideoProjectWorkspace } from "../../components/video-collaboration/VideoProjectWorkspace";

export default async function VideoProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <FeaturePageShell activeFeature="video-collaboration">
      <VideoProjectWorkspace projectId={projectId} />
    </FeaturePageShell>
  );
}

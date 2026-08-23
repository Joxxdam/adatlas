import { FeaturePageShell } from "../../../components/AppFeatureNavigation";
import { VideoProjectWorkspace } from "../../../components/video-collaboration/VideoProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function VideoPlanningProductionPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <FeaturePageShell activeFeature="video-planning">
      <VideoProjectWorkspace basePath="/video-planning" projectId={projectId} />
    </FeaturePageShell>
  );
}

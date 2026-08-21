import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { VideoPlanningProjectWorkspace } from "../../components/video-planning/VideoPlanningProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function VideoPlanningProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <FeaturePageShell activeFeature="video-planning"><VideoPlanningProjectWorkspace projectId={projectId} /></FeaturePageShell>;
}

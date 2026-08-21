import { FeaturePageShell } from "../../../../components/AppFeatureNavigation";
import { VideoPlanningConceptWorkspace } from "../../../../components/video-planning/VideoPlanningConceptWorkspace";

export const dynamic = "force-dynamic";

export default async function VideoPlanningConceptPage({ params }: { params: Promise<{ projectId: string; conceptId: string }> }) {
  const { projectId, conceptId } = await params;
  return <FeaturePageShell activeFeature="video-planning"><VideoPlanningConceptWorkspace projectId={projectId} conceptId={conceptId} /></FeaturePageShell>;
}

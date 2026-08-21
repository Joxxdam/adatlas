import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { VideoPlanningList } from "../components/video-planning/VideoPlanningList";

export const dynamic = "force-dynamic";

export default function VideoPlanningPage() {
  return <FeaturePageShell activeFeature="video-planning"><VideoPlanningList /></FeaturePageShell>;
}

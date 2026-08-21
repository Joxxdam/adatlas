import { Suspense } from "react";
import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { NewVideoProjectWorkspace } from "../../components/video-collaboration/NewVideoProjectWorkspace";

export default function NewVideoPlanningPage() {
  return (
    <FeaturePageShell activeFeature="video-planning">
      <Suspense fallback={<main style={{ padding: 40 }}>영상 기획 화면을 준비하고 있습니다.</main>}>
        <NewVideoProjectWorkspace />
      </Suspense>
    </FeaturePageShell>
  );
}

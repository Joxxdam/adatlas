import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { StoreAnalysisForm } from "../components/store-analysis/StoreAnalysisForm";

export const dynamic = "force-dynamic";

export default function AnalyzeStorePage() {
  return (
    <FeaturePageShell activeFeature="store-analysis">
      <StoreAnalysisForm />
    </FeaturePageShell>
  );
}

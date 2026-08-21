import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { PerformanceWorkspace } from "../components/meta/PerformanceWorkspace";
import { hookExperimentRepository } from "../lib/hook-experiments/repository.server";
import { metaRepository } from "../lib/meta/repository.server";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const [metaStore, legacy] = await Promise.all([
    metaRepository.read(),
    hookExperimentRepository.list(),
  ]);
  return (
    <FeaturePageShell activeFeature="performance">
      <PerformanceWorkspace
        initialExperiments={metaStore.performance}
        legacyExperiments={legacy.map((item) => ({
          id: item.experiment.id,
          code: item.experiment.experimentCode,
          advertiserName: item.experiment.advertiserName,
          productName: item.experiment.product.productName,
          status: item.experiment.status,
          objective: item.experiment.objective,
          hookCount: item.experiment.hookCount,
        }))}
      />
    </FeaturePageShell>
  );
}

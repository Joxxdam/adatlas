import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { PerformanceWorkspace } from "../components/meta/PerformanceWorkspace";
import { hookExperimentRepository } from "../lib/hook-experiments/repository.server";
import { listCreativeArchiveEntries } from "../lib/creative-archive/service.server";
import { metaRepository } from "../lib/meta/repository.server";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selectedIds = (single(params.entryIds) || "").split(",").filter(Boolean).slice(0, 6);
  const [metaStore, legacy, archiveEntries] = await Promise.all([
    metaRepository.read(),
    hookExperimentRepository.list(),
    selectedIds.length ? listCreativeArchiveEntries() : Promise.resolve([]),
  ]);
  const byId = new Map(archiveEntries.map((entry) => [entry.id, entry]));
  const selectedArchiveEntries = selectedIds
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return (
    <FeaturePageShell activeFeature="performance">
      <PerformanceWorkspace
        initialExperiments={metaStore.performance}
        selectedArchiveEntries={selectedArchiveEntries}
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

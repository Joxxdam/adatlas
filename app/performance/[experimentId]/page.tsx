import { notFound } from "next/navigation";
import { FeaturePageShell } from "../../components/AppFeatureNavigation";
import { PerformanceDetail } from "../../components/meta/PerformanceWorkspace";
import { metaRepository } from "../../lib/meta/repository.server";

export const dynamic = "force-dynamic";

export default async function PerformanceDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const experiment = (await metaRepository.read()).performance.find(
    (item) => item.id === experimentId
  );
  if (!experiment) notFound();
  return (
    <FeaturePageShell activeFeature="performance">
      <PerformanceDetail experiment={experiment} />
    </FeaturePageShell>
  );
}

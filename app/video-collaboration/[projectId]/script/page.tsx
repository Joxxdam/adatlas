import { VideoScriptWorkspace } from "../../../components/video-collaboration/VideoScriptWorkspace";

export const dynamic = "force-dynamic";

export default async function VideoScriptPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <VideoScriptWorkspace projectId={projectId} />;
}

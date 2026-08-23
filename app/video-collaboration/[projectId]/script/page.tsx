import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function VideoScriptPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/video-planning/${projectId}`);
}

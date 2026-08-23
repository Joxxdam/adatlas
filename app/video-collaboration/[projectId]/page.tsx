import { redirect } from "next/navigation";

export default async function VideoProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/video-planning/${projectId}`);
}

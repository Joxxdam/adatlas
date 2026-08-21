import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ImageAnalysisReferencesPage() {
  redirect("/admin/references?tab=analysis");
}

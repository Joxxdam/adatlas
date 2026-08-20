import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AutoProductionPage() {
  redirect("/admin/auto-production");
}

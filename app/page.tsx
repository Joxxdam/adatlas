import { MvpDashboard } from "./components/MvpDashboard";
import { readBrands, readGenerated, readImages } from "./lib/mvp/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [brands, images, generated] = await Promise.all([readBrands(), readImages(), readGenerated()]);

  return <MvpDashboard initialBrands={brands} initialGenerated={generated} initialImages={images} />;
}

import { MvpDashboard } from "../components/MvpDashboard";
import { readCollectedAdImages } from "../lib/mvp/collectedImageStore";
import { readBrands, readGenerated } from "../lib/mvp/store";

export const dynamic = "force-dynamic";

export default async function ImageAnalysisReferencesPage() {
  const [brands, images, generated] = await Promise.all([
    readBrands(),
    readCollectedAdImages(),
    readGenerated(),
  ]);

  return (
    <MvpDashboard
      activeFeature="image-references"
      initialActiveMenu="이미지 분석"
      initialBrands={brands}
      initialGenerated={generated}
      initialImages={images}
    />
  );
}

import { FeaturePageShell } from "../components/AppFeatureNavigation";
import { CategoryCreativeWorkspace } from "../components/category-creatives/CategoryCreativeWorkspace";

export const dynamic = "force-dynamic";

export default async function CategoryImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  return <FeaturePageShell activeFeature="category-creative"><CategoryCreativeWorkspace initialAdvertiserId={value("advertiserId")} initialAdvertiserName={value("advertiserName")} initialCategoryId={value("categoryId")} initialCategoryName={value("categoryName")} /></FeaturePageShell>;
}

import type { ProductInfoForPrompt } from "../mvp/types";

export type ProductCopyDomain = "personal-care" | "beauty" | "snack" | "food" | "general";

type ProductCopySemanticInput = Pick<
  ProductInfoForPrompt,
  "category" | "productName" | "productSubCategory" | "detectedProductType"
>;

function normalizedProductContext(product: ProductCopySemanticInput) {
  return [product.category, product.productSubCategory, product.productName, product.detectedProductType]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
}

/**
 * 상품의 최종 사용 카테고리를 원료·향 신호보다 먼저 판정합니다.
 * 예: `fruit`로 추출된 루바브 바디워시도 먹는 과일이 아니라 personal-care입니다.
 */
export function resolveProductCopyDomain(product: ProductCopySemanticInput): ProductCopyDomain {
  const context = normalizedProductContext(product);
  if (/샤워젤|바디\s*워시|샴푸|트리트먼트|데오드란트|치약|핸드\s*워시|세정제|비누|퍼스널\s*케어|personal\s*care|body\s*wash|shower\s*gel|shampoo/u.test(context)) {
    return "personal-care";
  }
  if (/화장품|뷰티|스킨\s*케어|세럼|앰플|크림|로션|토너|에센스|클렌저|선크림|메이크업|cosmetic|beauty|skin\s*care/u.test(context)) {
    return "beauty";
  }
  if (/간식|스낵|과자|전병|곶감|말랭이|견과|디저트|빵|떡|사과|신고배|복숭아|무화과|과일|농산|snack|dessert|fruit|produce/u.test(context)) {
    return "snack";
  }
  if (/식품|음식|육류|수산|반찬|김치|밀키트|간편식|음료|주스|food|meat|meal|drink|juice/u.test(context)) {
    return "food";
  }
  return "general";
}

const EDIBLE_ACTION = /(?:오늘\s*간식|간식\s*(?:생각|고를|으로)|한입|먹어|먹기|먹자|드셔|씹(?:는|어|을)|식탁|메뉴|끼니|반찬|출출|배고|맛있|다과)/u;
const PERSONAL_CARE_ACTION = /(?:샤워|목욕|거품\s*샤워|씻고\s*나오|피부에\s*바르|바디\s*워시|샤워젤|샴푸|욕실\s*루틴)/u;

/** 사실 검수와 별개로 상품을 먹거나 바르는 대상으로 뒤바꾼 명백한 의미 충돌만 차단합니다. */
export function findProductCopySemanticErrors(copy: string, product: ProductCopySemanticInput) {
  const domain = resolveProductCopyDomain(product);
  const normalizedCopy = String(copy || "").replace(/\s+/g, " ").trim();
  if (!normalizedCopy) return [];
  if ((domain === "personal-care" || domain === "beauty") && EDIBLE_ACTION.test(normalizedCopy)) {
    return ["상품 카테고리 의미 충돌: 화장품·퍼스널케어를 먹는 음식이나 간식처럼 표현했습니다."];
  }
  if ((domain === "snack" || domain === "food") && PERSONAL_CARE_ACTION.test(normalizedCopy)) {
    return ["상품 카테고리 의미 충돌: 식품을 샤워·세정·피부 도포 제품처럼 표현했습니다."];
  }
  return [];
}

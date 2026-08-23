export const AI_GENERATED_IMAGE_DISCLOSURE = "Ai생성이미지를활용하였습니다.";

export type AdvertiserLogo = {
  id: string;
  label: string;
  imagePath: string;
};

export type DeliveryBrandingSelection = {
  logoId?: string;
  aiDisclosure: boolean;
};

export type DeliveryBrandingRequest = {
  logoId?: string;
  aiDisclosure?: boolean;
  clear?: boolean;
};

export const advertiserLogos: AdvertiserLogo[] = [
  { id: "gemma-world", label: "젬마월드", imagePath: "/brand-logos/advertisers/gemma-world.png" },
  { id: "laroom", label: "라룸", imagePath: "/brand-logos/advertisers/laroom.png" },
  { id: "ode", label: "오드", imagePath: "/brand-logos/advertisers/ode.png" },
  { id: "story-nine", label: "스토리나인", imagePath: "/brand-logos/advertisers/story-nine.png" },
  { id: "yumer", label: "유메르", imagePath: "/brand-logos/advertisers/yumer.png" },
  { id: "ririnco", label: "리리앤코", imagePath: "/brand-logos/advertisers/ririnco.png" },
  { id: "kwonjo", label: "권조", imagePath: "/brand-logos/advertisers/kwonjo.png" },
  { id: "canmart", label: "캔마트", imagePath: "/brand-logos/advertisers/canmart.png" },
  {
    id: "original-source",
    label: "오리지널소스",
    imagePath: "/brand-logos/advertisers/original-source.png",
  },
  { id: "deepny", label: "디프니", imagePath: "/brand-logos/advertisers/deepny.png" },
  { id: "dint", label: "딘트", imagePath: "/brand-logos/advertisers/dint.png" },
  { id: "blackup", label: "블랙업", imagePath: "/brand-logos/advertisers/blackup.png" },
  { id: "the-mood", label: "더무드", imagePath: "/brand-logos/advertisers/the-mood.png" },
  { id: "slowand", label: "슬로우앤드", imagePath: "/brand-logos/advertisers/slowand.png" },
  { id: "hotping", label: "핫핑", imagePath: "/brand-logos/advertisers/hotping.png" },
  {
    id: "gukdae-hanwoo",
    label: "국대한우",
    imagePath: "/brand-logos/advertisers/gukdae-hanwoo.png",
  },
];

export function findAdvertiserLogo(logoId: string | undefined) {
  return advertiserLogos.find((logo) => logo.id === logoId);
}

export function normalizeDeliveryBrandingRequest(input: DeliveryBrandingRequest) {
  const logoId = String(input.logoId || "").trim() || undefined;
  const aiDisclosure = input.aiDisclosure === true;
  const clear = input.clear === true;
  if (logoId && !findAdvertiserLogo(logoId)) {
    throw new Error("선택한 업체 로고가 목록에 없습니다.");
  }
  if (!clear && !logoId && !aiDisclosure) {
    throw new Error("적용할 로고 또는 AI 생성 이미지 고지를 선택해 주세요.");
  }
  return { logoId, aiDisclosure, clear };
}

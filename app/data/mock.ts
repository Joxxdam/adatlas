export type Reference = {
  id: string;
  title: string;
  brand: string;
  platform: string;
  thumbnailLabel: string;
  mediaTypeLabel: string;
  industry: string;
  frames: string[];
  hook: string;
  cta: string;
  aiScore: number;
  compatibility: {
    brandName: string;
    score: number;
    reason: string;
  }[];
  boards: string[];
  palette: string[];
};

export const summaryCards = [
  { label: "오늘 신규 레퍼런스", value: "42개", detail: "Meta 15 / TikTok 8 / Pinterest 12" },
  { label: "이번 주 수집", value: "186개", detail: "지난주 대비 +24%" },
  { label: "AI 분석 완료", value: "38개", detail: "분석 대기 4개" },
  { label: "브랜드 추천", value: "31개", detail: "Original Source 12 / Storynine 9" },
];

export const references: Reference[] = [
  {
    id: "original-source-cooling",
    title: "민트 쿨링 샤워젤 UGC 광고",
    brand: "Original Source",
    platform: "TikTok Creative Center",
    thumbnailLabel: "샤워 후 쿨링 데모",
    mediaTypeLabel: "영상",
    industry: "뷰티",
    frames: ["문제 해결", "UGC", "숫자 증명"],
    hook: "샤워해도 계속 더운 사람?",
    cta: "지금 여름 한정으로 만나보기",
    aiScore: 96,
    compatibility: [
      { brandName: "Original Source", score: 94, reason: "쿨링 USP와 여름 시즌 메시지가 직접 연결됩니다." },
      { brandName: "Storynine", score: 31, reason: "업종과 구매 맥락이 다릅니다." },
      { brandName: "Kookdae Hanwoo", score: 12, reason: "식품 카테고리와 전환성이 낮습니다." },
      { brandName: "Bebetailor", score: 76, reason: "사용 장면 중심 구조는 참고할 수 있습니다." },
    ],
    boards: ["Original Source", "UGC", "여름", "고전환 훅"],
    palette: ["#2dd4bf", "#111827", "#f8fafc"],
  },
  {
    id: "storynine-rain-look",
    title: "장마 출근룩 캐러셀",
    brand: "Storynine",
    platform: "Meta Ad Library",
    thumbnailLabel: "장마룩 5가지 코디",
    mediaTypeLabel: "캐러셀",
    industry: "패션",
    frames: ["리스트형", "상황 제안", "시즌"],
    hook: "비 오는 날에도 구김 없이 입는 출근룩",
    cta: "이번 주 코디 보기",
    aiScore: 91,
    compatibility: [
      { brandName: "Original Source", score: 28, reason: "시즌 구조만 참고 가능합니다." },
      { brandName: "Storynine", score: 96, reason: "브랜드 톤과 타깃이 정확히 맞습니다." },
      { brandName: "Kookdae Hanwoo", score: 18, reason: "상품 맥락이 다릅니다." },
      { brandName: "Bebetailor", score: 69, reason: "상황별 코디 프레임은 키즈 패션에도 적용 가능합니다." },
    ],
    boards: ["Storynine", "패션", "장마", "시즌 기획"],
    palette: ["#93c5fd", "#1f2937", "#e5e7eb"],
  },
  {
    id: "kookdae-weekend",
    title: "주말 한우 특가 배너",
    brand: "Kookdae Hanwoo",
    platform: "Google Ads Transparency",
    thumbnailLabel: "등급과 가격 비교",
    mediaTypeLabel: "이미지",
    industry: "식품",
    frames: ["가격", "비교", "긴급성"],
    hook: "이번 주말, 1등급 한우를 이 가격에",
    cta: "주말 특가 확인",
    aiScore: 88,
    compatibility: [
      { brandName: "Original Source", score: 16, reason: "카테고리 차이가 큽니다." },
      { brandName: "Storynine", score: 22, reason: "가격 강조 구조만 참고 가능합니다." },
      { brandName: "Kookdae Hanwoo", score: 95, reason: "USP와 매체 목적이 모두 일치합니다." },
      { brandName: "Bebetailor", score: 33, reason: "행사 메시지 구조는 일부 차용 가능합니다." },
    ],
    boards: ["Kookdae Hanwoo", "식품", "특가", "클릭률"],
    palette: ["#dc2626", "#facc15", "#111827"],
  },
];

export const trendNotes = [
  "사용 전후 비교형 광고 증가",
  "숫자 기반 훅 문구 증가",
  "여름과 쿨링 소재 증가",
  "3초 안에 문제를 제기하는 영상 증가",
];

export const crawlSources = [
  { name: "Meta Ad Library", status: "API 연결 필요", data: "Facebook/Instagram 광고, 문구, 광고주, 시작일, 국가" },
  { name: "TikTok Creative Center", status: "API 엔드포인트 필요", data: "Top Ads, 업종, 국가, 좋아요, 영상" },
  { name: "Pinterest", status: "API 토큰 필요", data: "이미지, 키워드, 스타일, 보드" },
  { name: "직접 업로드", status: "수동 수집", data: "이미지, 영상, PDF, 랜딩 URL" },
];

export const dailyBrief = {
  newReferences: ["Meta: 15개", "TikTok: 8개", "Pinterest: 12개", "수동 업로드: 7개"],
  trends: ["UGC 증가", "숫자 훅 증가", "여름 시즌 USP 증가", "비교 프레임 증가"],
  actions: [
    "Original Source 쿨링 릴스 3종 제작",
    "Storynine 장마룩 문자 소재 작성",
    "Kookdae Hanwoo 주말 특가 배너 제작",
  ],
};

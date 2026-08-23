import type { GraphicComponentPreset } from "./types";

function component(id: string, label: string, layer: GraphicComponentPreset["layer"], purpose: string, editable: GraphicComponentPreset["editable"] = ["text", "visible", "position", "size", "style", "zIndex"]): GraphicComponentPreset {
  return { id, label, layer, purpose, editable };
}

export const graphicComponentPresets: GraphicComponentPreset[] = [
  component("GiantHeadline", "초대형 헤드라인", "text", "1–2초 내 핵심 후킹 전달"),
  component("SubHeadline", "서브 헤드라인", "text", "후킹을 상품 혜택으로 연결"),
  component("HighlightBox", "강조 박스", "text", "짧은 혜택이나 근거 강조"),
  component("NumericBadge", "숫자 배지", "text", "확인된 가격·구성·수치 강조"),
  component("BenefitChip", "혜택 칩", "text", "하나의 짧은 혜택 표시"),
  component("ThreeBenefitRow", "3가지 혜택", "text", "동등한 세 가지 사용 이유 정리"),
  component("ReviewCard", "후기 카드", "above-product", "사용자 반응 문법 표시"),
  component("CommunityPostCard", "커뮤니티 카드", "above-product", "캡처형 정보 위계 구성"),
  component("HashtagPill", "해시태그 필", "text", "보조 사용 상황 표시"),
  component("AccentRibbon", "강조 리본", "above-product", "행사·시즌·제한 정보 강조"),
  component("FooterBar", "하단 정보 바", "footer", "오퍼나 품질 근거 묶음"),
  component("CTAButton", "CTA 버튼", "footer", "짧은 행동 유도"),
  component("CTAStrip", "CTA 스트립", "footer", "전체 폭 하단 행동 유도"),
  component("ProductHalo", "제품 할로", "behind-product", "배경과 제품 분리", ["visible", "position", "size", "style", "zIndex"]),
  component("ProductShadow", "제품 그림자", "product", "접지감과 깊이", ["visible", "position", "size", "style", "zIndex"]),
  component("ProductOutline", "제품 외곽선", "product", "복잡한 배경에서 제품 분리", ["visible", "size", "style", "zIndex"]),
  component("ScribbleArrow", "손그림 화살표", "above-product", "한 가지 주목 포인트 안내", ["visible", "position", "size", "style", "zIndex"]),
  component("EmphasisUnderline", "강조 밑줄", "text", "핵심 단어 하나를 선택적으로 강조", ["visible", "position", "size", "style", "zIndex"]),
  component("SceneOverlay", "장면 오버레이", "above-product", "글자 대비와 시선 집중", ["visible", "position", "size", "style", "zIndex"]),
  component("GradientScrim", "그라데이션 스크림", "behind-product", "배경과 글자 대비 확보", ["visible", "position", "size", "style", "zIndex"]),
];

export function getGraphicComponentPreset(id: string) {
  return graphicComponentPresets.find((item) => item.id === id);
}

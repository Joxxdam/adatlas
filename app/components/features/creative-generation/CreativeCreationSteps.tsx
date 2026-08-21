type CreativeCreationStepsProps = {
  currentProductLoaded: boolean;
  generationPlanConfirmed: boolean;
};

export function CreativeCreationSteps({
  currentProductLoaded,
  generationPlanConfirmed,
}: CreativeCreationStepsProps) {
  return (
    <ol className="creation-flow-overview" aria-label="광고 콘텐츠 제작 흐름">
      <li className={currentProductLoaded ? "done" : "active"}>
        <b>1</b>
        <span><strong>상품 확인</strong><small>주소를 분석하고 상품을 확인합니다</small></span>
      </li>
      <li className={generationPlanConfirmed ? "done" : currentProductLoaded ? "active" : ""}>
        <b>2</b>
        <span><strong>상품 고유 후킹 6개</strong><small>상세페이지 근거로 흔하지 않은 문구를 만듭니다</small></span>
      </li>
      <li className={generationPlanConfirmed ? "done" : ""}>
        <b>3</b>
        <span><strong>AI 광고 6장 완성</strong><small>후킹마다 장면과 디자인 전체를 별도로 제작합니다</small></span>
      </li>
    </ol>
  );
}

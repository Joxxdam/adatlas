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
        <span><strong>광고 목표 선택</strong><small>이번 광고에서 만들 반응을 정합니다</small></span>
      </li>
      <li className={generationPlanConfirmed ? "done" : ""}>
        <b>3</b>
        <span><strong>후킹 6개 선정</strong><small>상품 근거로 후보를 만들고 최종 가설을 고릅니다</small></span>
      </li>
      <li className={generationPlanConfirmed ? "active" : ""}>
        <b>4</b>
        <span><strong>AI 광고 6장 완성</strong><small>후킹마다 장면과 디자인 전체를 별도로 제작합니다</small></span>
      </li>
    </ol>
  );
}

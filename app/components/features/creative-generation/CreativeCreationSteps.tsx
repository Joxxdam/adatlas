type CreativeCreationStepsProps = {
  currentProductLoaded: boolean;
  generationPlanConfirmed: boolean;
};

export function CreativeCreationSteps({ currentProductLoaded, generationPlanConfirmed }: CreativeCreationStepsProps) {
  return (
    <ol className="creation-flow-overview" aria-label="광고 콘텐츠 제작 흐름">
      <li className={currentProductLoaded ? "done" : "active"}>
        <b>1</b>
        <span>
          <strong>상품 확인</strong>
          <small>주소를 분석하고 상품을 확인합니다</small>
        </span>
      </li>
      <li className={generationPlanConfirmed ? "done" : currentProductLoaded ? "active" : ""}>
        <b>2</b>
        <span>
          <strong>상품군 레퍼런스 6장 선택</strong>
          <small>패션·음식·화장품 중 같은 상품군에서 무작위로 고정합니다</small>
        </span>
      </li>
      <li className={generationPlanConfirmed ? "done" : ""}>
        <b>3</b>
        <span>
          <strong>상품·문구 단계별 교체</strong>
          <small>URL 상품과 검증 문구만 바꾸고 디자인을 유지합니다</small>
        </span>
      </li>
    </ol>
  );
}

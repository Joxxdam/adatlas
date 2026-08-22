"use client";

import type { AdBrief } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function ProductBriefForm(props: {
  brief: AdBrief;
  canConfirm: boolean;
  confirmed: boolean;
  onChange: (brief: AdBrief) => void;
  onConfirm: () => void;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.sectionStep}>2 · 상품 고유 후킹 만들기</span>
          <h4>상세페이지에서만 나올 수 있는 후킹 6개</h4>
          <p>광고 목표를 따로 고르지 않습니다. 상품의 실제 특징·사용 상황·고객 긴장·수치 근거를 분석해 흔한 상품명형 문구를 제외합니다.</p>
        </div>
      </div>
      <div className={styles.recommendedDirection}>
        <div>
          <span>자동 제작 원칙</span>
          <strong>상세페이지 근거 → 비정형 후킹 6개 → 서로 다른 AI 광고 6장</strong>
          <p>질문형·상황형·반전형·감각형·근거형 등 문장 리듬과 전체 장면을 후킹마다 다르게 만듭니다.</p>
        </div>
        <small>상품 형태·패키지·색상과 확인된 사실은 유지하고, 일반적인 표현이나 확인되지 않은 주장은 사용하지 않습니다.</small>
      </div>
      <div className={`${styles.confirmBar} ${props.confirmed ? styles.confirmBarDone : ""}`}>
        <span>
          {props.confirmed
            ? "상품 분석이 완료되었습니다. 아래 제작 영역에서 진행 상태와 결과를 확인할 수 있습니다."
            : props.canConfirm
              ? "별도 설정 없이 상품 분석 결과로 바로 제작합니다."
              : "먼저 상품 정보와 광고용 이미지를 불러와 주세요."}
        </span>
        <button disabled={!props.canConfirm || props.confirmed} onClick={props.onConfirm} type="button">
          {props.confirmed ? "상품 분석 완료" : "광고 이미지 만들기"}
        </button>
      </div>
    </section>
  );
}

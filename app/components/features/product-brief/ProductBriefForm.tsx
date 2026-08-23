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
          <span className={styles.sectionStep}>2 · 상품 사실과 광고 문구 확인</span>
          <h4>URL 상품에 맞는 검증 문구 6개 준비</h4>
          <p>상품의 실제 특징·사용 상황·고객 긴장·수치 근거를 분석합니다. 이 문구는 ZIP 레퍼런스를 고르는 기준이 아니라 선택된 광고의 기존 문구를 교체하는 데만 사용합니다.</p>
        </div>
      </div>
      <div className={styles.recommendedDirection}>
        <div>
          <span>자동 제작 원칙</span>
          <strong>상세페이지 근거 → 같은 상품군 ZIP 6장 → 상품만 교체 → 문구만 교체</strong>
          <p>디자인은 사용자 제공 레퍼런스를 유지하고, 상품과 문구만 단계별로 잠금 편집합니다.</p>
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

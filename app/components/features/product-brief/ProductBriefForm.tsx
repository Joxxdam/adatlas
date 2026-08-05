"use client";

import { formatBriefList, parseBriefList } from "../../../lib/mvp/adBrief";
import type { AdBrief } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

const objectiveOptions: Array<{
  value: AdBrief["adObjective"];
  label: string;
  description: string;
}> = [
  {
    value: "purchase",
    label: "구매 전환",
    description: "가격·혜택·구매 이유를 강조해 즉시 구매를 유도",
  },
  {
    value: "signup",
    label: "신규 고객 확보",
    description: "처음 보는 고객도 상품의 차별점과 필요성을 이해하도록 구성",
  },
  {
    value: "awareness",
    label: "브랜드 인지도",
    description: "브랜드 이미지와 대표 메시지를 기억하게 만드는 데 집중",
  },
  {
    value: "retargeting",
    label: "재구매·리타겟팅",
    description: "상품을 이미 본 고객에게 혜택과 구매 필요성을 다시 강조",
  },
];

const intensityOptions: Array<{
  value: AdBrief["creativeIntensity"];
  label: string;
  description: string;
}> = [
  {
    value: "brand",
    label: "부드럽게",
    description: "공감과 이미지 중심의 자연스러운 표현",
  },
  {
    value: "balanced",
    label: "균형 있게",
    description: "상품 장점과 구매 혜택을 함께 강조",
  },
  {
    value: "performance",
    label: "강하게",
    description: "가격·할인·한정성·행동 유도를 직접적으로 강조",
  },
];

function FieldTitle({ children, help }: { children: string; help: string }) {
  return (
    <div className={styles.fieldTitle}>
      <span>{children}</span>
      <span className={styles.helpTip}>
        <button aria-label={`${children} 도움말`} type="button">
          ?
        </button>
        <span role="tooltip">{help}</span>
      </span>
    </div>
  );
}

export function ProductBriefForm(props: { brief: AdBrief; onChange: (brief: AdBrief) => void }) {
  const set = <Key extends keyof AdBrief>(key: Key, value: AdBrief[Key]) => {
    props.onChange({ ...props.brief, [key]: value });
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>광고 브리프</h4>
          <p>
            필수 선택 두 가지면 충분합니다. 나머지 광고 방향은 상품과 레퍼런스로 자동 분석합니다.
          </p>
        </div>
      </div>
      <div className={styles.briefChoiceLayout}>
        <div className={styles.briefChoiceGroup}>
          <FieldTitle help="광고에서 가장 우선할 성과를 선택합니다.">광고 목표</FieldTitle>
          <div className={`${styles.choiceGrid} ${styles.objectiveGrid}`}>
            {objectiveOptions.map((option) => (
              <label
                className={`${styles.choiceCard} ${props.brief.adObjective === option.value ? styles.choiceCardSelected : ""}`}
                key={option.value}
              >
                <input
                  checked={props.brief.adObjective === option.value}
                  name="ad-objective"
                  onChange={() => set("adObjective", option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className={styles.briefChoiceGroup}>
          <FieldTitle help="문구의 판매 압박과 행동 유도 수준을 조절합니다.">광고 강도</FieldTitle>
          <div className={`${styles.choiceGrid} ${styles.intensityGrid}`}>
            {intensityOptions.map((option) => (
              <label
                className={`${styles.choiceCard} ${props.brief.creativeIntensity === option.value ? styles.choiceCardSelected : ""}`}
                key={option.value}
              >
                <input
                  checked={props.brief.creativeIntensity === option.value}
                  name="creative-intensity"
                  onChange={() => set("creativeIntensity", option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label className={styles.fullWidth}>
          추가 강조사항 <small>선택사항</small>
          <textarea
            value={props.brief.additionalEmphasis || ""}
            onChange={(event) => set("additionalEmphasis", event.target.value)}
            placeholder="예: 9,900원 가격을 가장 크게 강조 / 아이부터 어른까지 먹을 수 있다는 점 강조"
          />
          <small>
            상세페이지에서 자동으로 찾기 어려운 내용이나 이번 광고에서 특별히 강조할 내용만
            입력하세요.
          </small>
        </label>
      </div>

      <details className={styles.additionalSettings}>
        <summary>추가 설정</summary>
        <div className={styles.additionalSettingsBody}>
          <label className={styles.field}>
            필수 포함 정보 <small>선택사항</small>
            <textarea
              value={formatBriefList(props.brief.mandatoryInfo)}
              onChange={(event) => set("mandatoryInfo", parseBriefList(event.target.value))}
              placeholder="예: 9,900원, 무료배송, 1kg 구성"
            />
            <small>광고 이미지나 문구에 반드시 표시해야 하는 정보</small>
          </label>
          <label className={styles.field}>
            금지 표현 <small>선택사항</small>
            <textarea
              value={formatBriefList(props.brief.prohibitedClaims)}
              onChange={(event) => set("prohibitedClaims", parseBriefList(event.target.value))}
              placeholder="예: 최저가, 무조건, 치료, 1위"
            />
            <small>브랜드 정책이나 광고 심의상 사용하면 안 되는 표현</small>
          </label>
        </div>
      </details>
    </section>
  );
}

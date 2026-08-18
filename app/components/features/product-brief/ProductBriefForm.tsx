"use client";

import { formatBriefList, parseBriefList } from "../../../lib/mvp/adBrief";
import { getGenerationPlanSummary } from "../../../lib/mvp/adObjective";
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
    label: "브랜드·공감 중심",
    description: "사용 장면과 감각을 먼저 보여주고 자연스럽게 상품을 기억시킴",
  },
  {
    value: "balanced",
    label: "균형형 가설 테스트",
    description: "문제·USP·후기·혜택을 서로 다른 6개 방향으로 고르게 테스트",
  },
  {
    value: "performance",
    label: "전환 집중형",
    description: "확인된 가격·구성·근거와 CTA를 앞세워 빠른 행동을 유도",
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

export function ProductBriefForm(props: {
  brief: AdBrief;
  canConfirm: boolean;
  confirmed: boolean;
  onChange: (brief: AdBrief) => void;
  onConfirm: () => void;
}) {
  const set = <Key extends keyof AdBrief>(key: Key, value: AdBrief[Key]) => {
    props.onChange({ ...props.brief, [key]: value });
  };
  const plan = getGenerationPlanSummary(props.brief);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.sectionStep}>2 · 광고 이미지 만들기</span>
          <h4>AI가 추천한 광고 방향</h4>
          <p>상품 특징과 선택한 목표를 바탕으로 공통 광고 이미지를 먼저 만듭니다.</p>
        </div>
      </div>
      <div className={styles.recommendedDirection}>
        <div>
          <span>추천 방향</span>
          <strong>{plan.objectiveLabel} · {plan.approachLabel}</strong>
          <p>{plan.visual}</p>
        </div>
        <small>후킹 6종은 이 상품 원본을 보존하면서 각 메시지에 맞는 AI 콘텐츠로 제작합니다.</small>
      </div>

      <details className={styles.productionSettings}>
        <summary>제작 설정 변경 <small>선택사항</small></summary>
        <div className={styles.productionSettingsBody}>
          <div className={styles.briefChoiceGroup}>
            <FieldTitle help="광고에서 가장 우선할 성과를 선택합니다.">광고 목표</FieldTitle>
            <div className={`${styles.choiceGrid} ${styles.objectiveGrid}`}>
              {objectiveOptions.map((option) => (
                <label className={`${styles.choiceCard} ${props.brief.adObjective === option.value ? styles.choiceCardSelected : ""}`} key={option.value}>
                  <input checked={props.brief.adObjective === option.value} name="ad-objective" onChange={() => set("adObjective", option.value)} type="radio" value={option.value} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </div>
          </div>
          <div className={styles.briefChoiceGroup}>
            <FieldTitle help="H01~H06의 서로 다른 메시지 가설을 각 후킹에 맞는 AI 콘텐츠로 제작합니다.">메시지 제작 방식</FieldTitle>
            <div className={`${styles.choiceGrid} ${styles.intensityGrid}`}>
              {intensityOptions.map((option) => (
                <label className={`${styles.choiceCard} ${props.brief.creativeIntensity === option.value ? styles.choiceCardSelected : ""}`} key={option.value}>
                  <input checked={props.brief.creativeIntensity === option.value} name="creative-intensity" onChange={() => set("creativeIntensity", option.value)} type="radio" value={option.value} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </div>
          </div>
          <div className={styles.planPreview} aria-live="polite">
            <div><span>현재 제작 계획</span><strong>{plan.objectiveLabel} · {plan.approachLabel}</strong></div>
            <dl><dt>대상</dt><dd>{plan.audience}</dd><dt>문구</dt><dd>{plan.copy}</dd><dt>화면</dt><dd>{plan.visual}</dd><dt>CTA</dt><dd>{plan.cta}</dd></dl>
          </div>
          <label className={styles.fullWidth}>
            추가 강조사항 <small>선택사항</small>
            <textarea
              value={props.brief.additionalEmphasis || ""}
              onChange={(event) => set("additionalEmphasis", event.target.value)}
              placeholder="예: 확인된 9,900원 가격을 가장 크게 강조"
            />
            <small>이번 광고에 특별히 반영할 사실만 입력하세요.</small>
          </label>
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
      <div className={`${styles.confirmBar} ${props.confirmed ? styles.confirmBarDone : ""}`}>
        <span>
          {props.confirmed
            ? `${plan.objectiveLabel} 방향으로 광고 이미지를 만들고 있습니다.`
            : props.canConfirm
              ? "추천 설정은 나중에 다시 바꿀 수 있습니다."
              : "먼저 상품 정보와 광고용 이미지를 불러와 주세요."}
        </span>
        <button disabled={!props.canConfirm || props.confirmed} onClick={props.onConfirm} type="button">
          {props.confirmed ? "광고 이미지 제작 중" : "광고 이미지 만들기"}
        </button>
      </div>
    </section>
  );
}

"use client";

import { formatBriefList, parseBriefList } from "../../../lib/mvp/adBrief";
import type { AdBrief } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function ProductBriefForm(props: { brief: AdBrief; onChange: (brief: AdBrief) => void }) {
  const set = <Key extends keyof AdBrief>(key: Key, value: AdBrief[Key]) => {
    props.onChange({ ...props.brief, [key]: value });
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>퍼포먼스 광고 브리프</h4>
          <p>상품 사실 정보에 구매 목적과 고객의 장벽을 더해 광고 방향을 선명하게 만듭니다.</p>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label>
          광고 목표
          <select
            value={props.brief.adObjective}
            onChange={(event) => set("adObjective", event.target.value as AdBrief["adObjective"])}
          >
            <option value="purchase">구매</option>
            <option value="signup">가입·신청</option>
            <option value="awareness">인지</option>
          </select>
        </label>
        <label>
          목표 플랫폼
          <select
            value={props.brief.targetPlatform}
            onChange={(event) =>
              set("targetPlatform", event.target.value as AdBrief["targetPlatform"])
            }
          >
            <option value="meta-feed">Meta 피드</option>
            <option value="instagram-feed">Instagram 피드</option>
            <option value="naver-gfa">Naver GFA</option>
          </select>
        </label>
        <label>
          고객 인지 단계
          <select
            value={props.brief.awarenessStage}
            onChange={(event) =>
              set("awarenessStage", event.target.value as AdBrief["awarenessStage"])
            }
          >
            <option value="unaware">문제 미인지</option>
            <option value="problem-aware">문제 인지</option>
            <option value="solution-aware">해결책 탐색</option>
            <option value="comparing">상품 비교</option>
          </select>
        </label>
        <label>
          광고 강도
          <select
            value={props.brief.creativeIntensity}
            onChange={(event) =>
              set("creativeIntensity", event.target.value as AdBrief["creativeIntensity"])
            }
          >
            <option value="brand">브랜드 중심</option>
            <option value="balanced">균형형</option>
            <option value="performance">성과 중심</option>
          </select>
        </label>
        <label className={styles.fullWidth}>
          고객 문제
          <input
            value={props.brief.customerProblem}
            onChange={(event) => set("customerProblem", event.target.value)}
            placeholder="고객이 반복해서 겪는 불편이나 결핍"
          />
        </label>
        <label className={styles.fullWidth}>
          구매 장벽
          <input
            value={props.brief.purchaseBarrier}
            onChange={(event) => set("purchaseBarrier", event.target.value)}
            placeholder="가격, 신뢰, 필요성 등 망설이는 이유"
          />
        </label>
        <label>
          원하는 후킹 유형
          <input
            value={props.brief.desiredHookType}
            onChange={(event) => set("desiredHookType", event.target.value)}
            placeholder="예: 가격정당화형, 후기형"
          />
        </label>
        <label>
          오퍼 유형
          <input
            value={props.brief.offerType}
            onChange={(event) => set("offerType", event.target.value)}
            placeholder="예: 한정 특가, 묶음 구성"
          />
        </label>
        <label className={styles.fullWidth}>
          톤 선호
          <input
            value={props.brief.tonePreference}
            onChange={(event) => set("tonePreference", event.target.value)}
            placeholder="예: 강한 구어체, 차분한 프리미엄"
          />
        </label>
        <label className={styles.fullWidth}>
          증명 요소
          <textarea
            value={formatBriefList(props.brief.proofElements)}
            onChange={(event) => set("proofElements", parseBriefList(event.target.value))}
            placeholder="상세페이지에서 확인된 원산지, 구성, 인증, 후기 근거"
          />
        </label>
        <label className={styles.fullWidth}>
          반드시 포함할 정보
          <textarea
            value={formatBriefList(props.brief.mandatoryInfo)}
            onChange={(event) => set("mandatoryInfo", parseBriefList(event.target.value))}
            placeholder="쉼표 또는 줄바꿈으로 구분"
          />
        </label>
        <label className={styles.fullWidth}>
          금지 표현·주장
          <textarea
            value={formatBriefList(props.brief.prohibitedClaims)}
            onChange={(event) => set("prohibitedClaims", parseBriefList(event.target.value))}
            placeholder="사용하면 안 되는 표현을 입력"
          />
        </label>
      </div>
    </section>
  );
}

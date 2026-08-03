"use client";

import { referenceUsageAspectOptions } from "../../../lib/mvp/referenceUsage";
import type { AdImageLabel, ReferenceUsageSelection } from "../../../lib/mvp/types";
import styles from "../creative-workflow/CreativeWorkflow.module.css";

export function ReferenceUsageSelector(props: {
  references: AdImageLabel[];
  usages: ReferenceUsageSelection[];
  onChange: (usages: ReferenceUsageSelection[]) => void;
}) {
  const update = (next: ReferenceUsageSelection) => {
    props.onChange([...props.usages.filter((usage) => usage.imageId !== next.imageId), next]);
  };

  if (!props.references.length) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h4>레퍼런스 사용 범위</h4>
            <p>레퍼런스를 선택하면 어떤 요소를 참고할지 지정할 수 있습니다.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h4>레퍼런스 사용 범위</h4>
          <p>문구를 복사하지 않고 구조, 말투, 배치처럼 참고할 요소만 선택합니다.</p>
        </div>
      </div>
      <div className={styles.referenceList}>
        {props.references.map((reference) => {
          const usage = props.usages.find((item) => item.imageId === reference.imageId) || {
            imageId: reference.imageId,
            aspects: [],
            weight: 1,
          };
          return (
            <article className={styles.referenceCard} key={reference.imageId}>
              <div className={styles.referenceTitle}>
                {reference.localImagePath ? <img alt="" src={reference.localImagePath} /> : null}
                <div>
                  <strong>
                    {reference.brandName || reference.finalLabel?.category || "선택 레퍼런스"}
                  </strong>
                  <span>
                    {reference.finalLabel?.hookType || "후킹 유형 미지정"} ·{" "}
                    {reference.finalLabel?.appealPoint || "소구점 미지정"}
                  </span>
                </div>
              </div>
              <div className={styles.aspectGrid}>
                {referenceUsageAspectOptions.map((option) => (
                  <label className={styles.aspectLabel} key={option.value}>
                    <input
                      checked={usage.aspects.includes(option.value)}
                      onChange={(event) => {
                        const aspects = event.target.checked
                          ? [...usage.aspects, option.value]
                          : usage.aspects.filter((aspect) => aspect !== option.value);
                        update({ ...usage, aspects });
                      }}
                      type="checkbox"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

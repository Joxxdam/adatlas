"use client";

import { useState } from "react";
import Link from "next/link";
import type { CategoryCreativeJob } from "../../lib/category-creatives/types";
import styles from "./CategoryCreativeArchive.module.css";

export function CategoryCreativeArchive({ jobs }: { jobs: CategoryCreativeJob[] }) {
  const [archiveJobs, setArchiveJobs] = useState(jobs);
  const [deletingId, setDeletingId] = useState("");
  const [notice, setNotice] = useState("");

  async function deleteJob(job: CategoryCreativeJob) {
    if (deletingId) return;
    const confirmed = window.confirm(
      `${job.advertiserName} · ${job.categoryName} 카테고리 이미지와 작업 기록을 삭제할까요?\n삭제 후에는 복구할 수 없으며, 제작에 사용한 원본 상품 이미지는 유지됩니다.`,
    );
    if (!confirmed) return;

    setDeletingId(job.id);
    setNotice("");
    try {
      const response = await fetch(`/api/category-creatives/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "카테고리 이미지 삭제에 실패했습니다.");
      setArchiveJobs((current) => current.filter((entry) => entry.id !== job.id));
      setNotice(`${job.advertiserName} · ${job.categoryName} 카테고리 이미지를 삭제했습니다. 원본 상품 이미지는 유지됩니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "카테고리 이미지 삭제에 실패했습니다.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <p>CATEGORY IMAGE ARCHIVE</p>
          <h1>카테고리 이미지</h1>
          <span>상품 광고 아카이브와 구분해 보관합니다.</span>
        </div>
        <Link href="/category-images">새 카테고리 이미지 만들기</Link>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {archiveJobs.length ? (
        <div className={styles.grid}>
          {archiveJobs.map((job) => (
            <article key={job.id}>
              <div className={styles.meta}>
                <span>{job.advertiserName}</span>
                <b>{job.categoryName}</b>
                <small>{new Date(job.createdAt).toLocaleString("ko-KR")}</small>
              </div>
              {job.outputs ? (
                <div className={styles.images}>
                  <img alt={`${job.categoryName} 정사각형`} src={`/api/category-creatives/jobs/${job.id}/asset/square`} />
                  <img alt={`${job.categoryName} 세로형`} src={`/api/category-creatives/jobs/${job.id}/asset/vertical`} />
                </div>
              ) : <p className={styles.failed}>{job.error || "결과 없음"}</p>}
              <p>{job.copy.headline}</p>
              <div className={styles.actions}>
                {job.outputs ? <a className={styles.download} href={`/api/category-creatives/jobs/${job.id}/download`}>두 규격 ZIP 다운로드</a> : null}
                <Link
                  className={styles.recreate}
                  href={`/category-images?advertiserId=${encodeURIComponent(job.advertiserId)}&advertiserName=${encodeURIComponent(job.advertiserName)}&categoryId=${encodeURIComponent(job.categoryId)}&categoryName=${encodeURIComponent(job.categoryName)}`}
                >
                  다시 제작
                </Link>
                <button
                  className={styles.delete}
                  type="button"
                  disabled={Boolean(deletingId)}
                  onClick={() => void deleteJob(job)}
                >
                  {deletingId === job.id ? "삭제 중…" : "이미지 삭제"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className={styles.empty}>아직 완성된 카테고리 이미지가 없습니다.</div>}
    </section>
  );
}

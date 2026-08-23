"use client";

import type { ContentAngleRecommendation } from "../../lib/store-analysis/types";

export function ContentAngleList({ angles, selectedId, onSelect }: { angles: ContentAngleRecommendation[]; selectedId?: string; onSelect?: (id: string) => void }) {
  return (
    <div className="content-angle-list">
      {angles.map((angle) => (
        <button className={selectedId === angle.id ? "selected" : ""} key={angle.id} onClick={() => onSelect?.(angle.id)} type="button">
          <span>
            <b>{angle.name}</b>
            <em>{angle.type}</em>
          </span>
          <small>{angle.reason}</small>
          <i>{angle.score}점</i>
        </button>
      ))}
    </div>
  );
}

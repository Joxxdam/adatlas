import { intersectionArea, isInsideCanvas, moveBox } from "./geometry";
import type { CollisionItem, CollisionResult } from "./types";

function isIntentional(first: CollisionItem, second: CollisionItem) {
  return (
    first.intentionalOverlapWith?.includes(second.id) ||
    second.intentionalOverlapWith?.includes(first.id)
  );
}

export function resolveCollisions(params: {
  items: CollisionItem[];
  width?: number;
  height?: number;
  safePadding?: number;
}): CollisionResult {
  const width = params.width || 1200;
  const height = params.height || 1200;
  const padding = params.safePadding ?? 18;
  const finalItems = params.items.map((item) => ({
    ...item,
    boundingBox: { ...item.boundingBox },
  }));
  const collisions: CollisionResult["collisions"] = [];
  const actions: CollisionResult["actions"] = [];
  const warnings: string[] = [];

  for (const item of finalItems) {
    if (!isInsideCanvas(item.boundingBox, width, height, padding)) {
      const targetX = Math.min(
        Math.max(padding, item.boundingBox.x),
        width - padding - item.boundingBox.width
      );
      const targetY = Math.min(
        Math.max(padding, item.boundingBox.y),
        height - padding - item.boundingBox.height
      );
      if (item.allowMove !== false) {
        item.boundingBox.x = targetX;
        item.boundingBox.y = targetY;
        actions.push({
          targetId: item.id,
          action: "move",
          reason: "safe area 안으로 이동했습니다.",
        });
      } else {
        warnings.push(`${item.id} 슬롯이 safe area를 벗어났습니다.`);
      }
    }
  }

  for (let firstIndex = 0; firstIndex < finalItems.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < finalItems.length; secondIndex += 1) {
      const first = finalItems[firstIndex];
      const second = finalItems[secondIndex];
      if (!first.boundingBox.width || !second.boundingBox.width || isIntentional(first, second)) {
        continue;
      }
      const overlapArea = intersectionArea(first.boundingBox, second.boundingBox);
      if (!overlapArea) continue;
      collisions.push({ firstId: first.id, secondId: second.id, overlapArea });

      const target = first.priority <= second.priority ? first : second;
      const anchor = target === first ? second : first;
      let resolved = false;
      if (target.allowMove) {
        for (const delta of [16, -16, 28, -28, 42, -42]) {
          const moved = moveBox(target.boundingBox, 0, delta);
          if (
            isInsideCanvas(moved, width, height, padding) &&
            intersectionArea(moved, anchor.boundingBox) === 0
          ) {
            target.boundingBox = moved;
            actions.push({
              targetId: target.id,
              action: "move",
              reason: `${anchor.id}와 겹치지 않도록 위치를 조정했습니다.`,
            });
            resolved = true;
            break;
          }
        }
      }

      if (!resolved && target.allowHide && target.priority < 35) {
        target.boundingBox.width = 0;
        target.boundingBox.height = 0;
        actions.push({
          targetId: target.id,
          action: "hide-low-priority",
          reason: "핵심 요소 가독성을 위해 낮은 우선순위 요소를 숨겼습니다.",
        });
        resolved = true;
      }

      if (!resolved) {
        actions.push({
          targetId: target.id,
          action: target.allowShrink ? "shrink-text" : "failed",
          reason: target.allowShrink
            ? "렌더 단계에서 텍스트 크기 축소가 필요합니다."
            : "자동으로 해결하지 못한 충돌입니다.",
        });
        if (!target.allowShrink) {
          warnings.push(`${first.id}와 ${second.id}의 충돌을 확인해 주세요.`);
        }
      }
    }
  }

  return {
    hasCollision: collisions.length > 0,
    collisions,
    actions,
    finalItems,
    warnings,
  };
}

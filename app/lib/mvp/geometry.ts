import type { BoundingBox } from "./types";

export function intersectionArea(first: BoundingBox, second: BoundingBox) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  );
  return width * height;
}

export function isInsideCanvas(box: BoundingBox, width: number, height: number, padding = 0) {
  return (
    box.x >= padding &&
    box.y >= padding &&
    box.x + box.width <= width - padding &&
    box.y + box.height <= height - padding
  );
}

export function moveBox(box: BoundingBox, x: number, y: number): BoundingBox {
  return { ...box, x: box.x + x, y: box.y + y };
}

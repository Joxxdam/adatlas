import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inferNativeReferenceCategoryFromText,
  removeManagedNativeReference,
} from "../app/lib/creative-generation/referenceLibraryManagement.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("업로드 파일명 fallback도 패션·식품·화장품 세 그룹만 사용한다", () => {
  assert.equal(inferNativeReferenceCategoryFromText("여름 원피스 광고.png"), "fashion");
  assert.equal(inferNativeReferenceCategoryFromText("한우 선물세트.jpg"), "food");
  assert.equal(inferNativeReferenceCategoryFromText("비타민 건강기능식품.webp"), "beauty");
  assert.equal(inferNativeReferenceCategoryFromText("알 수 없는 상품.jpg"), "beauty");
});

test("삭제한 레퍼런스는 관리 목록에서 즉시 제거된다", () => {
  const items = [
    { id: "keep", categoryGroup: "food" },
    { id: "delete", categoryGroup: "beauty" },
  ];
  assert.deepEqual(removeManagedNativeReference(items, "delete").map((item) => item.id), ["keep"]);
});

test("제작 선택기는 정적 JSON import가 아니라 현재 관리 manifest를 매번 읽는다", async () => {
  const source = await read("app/lib/creative-generation/referenceCreativeLibrary.server.ts");
  assert.match(source, /function readReferenceItems/);
  assert.match(source, /readNativeReferenceManifestSync\(\)/);
  assert.doesNotMatch(source, /import manifest from/);
});

test("레퍼런스 관리 API는 목록·업로드·분류수정·삭제를 지원한다", async () => {
  const route = await read("app/api/admin/references/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /nativeReferenceLibraryRepository\.remove/);
});

test("레퍼런스 관리 기본 화면은 실제 제작 라이브러리와 업로드·삭제 UI를 표시한다", async () => {
  const page = await read("app/admin/references/page.tsx");
  const manager = await read("app/components/references/NativeReferenceLibraryManager.tsx");
  assert.match(page, /NativeReferenceLibraryManager/);
  assert.match(page, /tab = "library"/);
  assert.match(manager, /이미지 업로드/);
  assert.match(manager, /자동 분류/);
  assert.match(manager, /삭제/);
  assert.match(manager, /\/api\/admin\/references/);
});


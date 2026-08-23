import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { bundledFontOptions, resolveTemplateFontAssignment, templateFontAssignments } from "../app/lib/mvp/fontCatalog.ts";
import { foodCategoryTemplates, foodImpactHeroTemplate, optimizedCategoryTemplates } from "../lib/bannerTemplates.ts";

const repoRoot = process.cwd();
const licenseFiles = {
  "black-han-sans": "BlackHanSans-OFL.txt",
  "do-hyeon": "DoHyeon-OFL.txt",
  "gowun-batang-bold": "GowunBatang-OFL.txt",
  "nanum-pen-script": "NanumPenScript-OFL.txt",
  "noto-sans-kr": "NotoSansKR-OFL.txt",
};

test("bundled Korean fonts and their OFL licenses are stored in the project", async () => {
  assert.equal(bundledFontOptions.length, 5);

  for (const font of bundledFontOptions) {
    assert.equal(font.bundled, true, font.id);
    assert.equal(font.license, "SIL Open Font License 1.1", font.id);
    assert.ok(font.file?.startsWith("/fonts/"), font.id);

    const fontPath = path.join(repoRoot, "public", font.file);
    const fontStat = await stat(fontPath);
    assert.ok(fontStat.size > 100_000, `${font.id} font file is unexpectedly small`);

    const signature = await readFile(fontPath).then((buffer) => buffer.subarray(0, 4));
    assert.deepEqual([...signature], [0, 1, 0, 0], `${font.id} must be a TrueType font`);

    const licenseName = licenseFiles[font.id];
    assert.ok(licenseName, `${font.id} license mapping`);
    const licenseText = await readFile(path.join(repoRoot, "public", "fonts", "licenses", licenseName), "utf8");
    assert.match(licenseText, /SIL OPEN FONT LICENSE Version 1\.1/i, font.id);
  }
});

test("every selectable template resolves to bundled headline and body fonts", () => {
  const templates = [...foodCategoryTemplates, ...optimizedCategoryTemplates, foodImpactHeroTemplate];

  for (const template of templates) {
    const selection = resolveTemplateFontAssignment(template.id);
    assert.equal(selection.headline.bundled, true, `${template.id} headline`);
    assert.equal(selection.body.bundled, true, `${template.id} body`);
    assert.ok(selection.headline.file, `${template.id} headline file`);
    assert.ok(selection.body.file, `${template.id} body file`);
  }
});

test("template moods use distinct display fonts", () => {
  assert.equal(templateFontAssignments["auto-meat-impact-001"].headlineFontId, "black-han-sans");
  assert.equal(templateFontAssignments["auto-beauty-editorial-001"].headlineFontId, "gowun-batang-bold");
  assert.equal(templateFontAssignments["auto-beauty-proof-002"].headlineFontId, "do-hyeon");
  assert.equal(templateFontAssignments["ugc-meme-005"].headlineFontId, "nanum-pen-script");
});

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const promptData = JSON.parse(await fs.readFile(path.join(root, "data/background-generation-prompts.json"), "utf8"));
const metadataPath = path.join(root, "data/background-library.json");
const dryRun = process.argv.includes("--dry-run");
const categoryIndex = process.argv.indexOf("--category");
const category = categoryIndex >= 0 ? process.argv[categoryIndex + 1] : "";
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : Number.POSITIVE_INFINITY;
const prompts = promptData.prompts.filter((item) => !category || item.category === category).slice(0, limit);
if (!prompts.length) throw new Error("생성할 프롬프트가 없습니다.");
if (dryRun) {
  prompts.forEach((item) => process.stdout.write(`${item.id}\n${item.prompt}\n${promptData.defaults.required}\n\n`));
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 필요합니다. --dry-run으로 프롬프트만 검토할 수 있습니다.");

const current = JSON.parse(await fs.readFile(metadataPath, "utf8"));
for (const item of prompts) {
  const prompt = `${item.prompt}\n\n${promptData.defaults.required}`;
  const response = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt, size: "1200x1200", quality: "high", background: "opaque", output_format: "png", n: 1 }), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) { process.stderr.write(`FAIL ${item.id} HTTP ${response.status}\n`); continue; }
  const payload = await response.json();
  const source = payload.data?.[0]?.b64_json ? Buffer.from(payload.data[0].b64_json, "base64") : payload.data?.[0]?.url ? Buffer.from(await (await fetch(payload.data[0].url)).arrayBuffer()) : null;
  if (!source) { process.stderr.write(`FAIL ${item.id} 이미지 데이터 없음\n`); continue; }
  const id = `${item.id}-${randomUUID().slice(0,8)}`;
  const relative = `/background-library/${item.category}/${id}.webp`;
  const output = path.join(root, "public", relative.replace(/^\//, ""));
  await fs.mkdir(path.dirname(output), { recursive: true });
  const buffer = await sharp(source).rotate().resize(1600,1600,{fit:"cover",position:"attention"}).webp({quality:82,effort:5}).toBuffer();
  await fs.writeFile(output, buffer);
  const now = new Date().toISOString();
  current.push({ id, file: relative, enabled: false, category: item.category, subcategories: [], industries: [item.category], assetType: "ai_generated", hookTypes: ["situation","usp_proof"], ageGroups: ["no_people"], peopleType: ["no_people"], peopleCount: 0, includesPerson: false, personPosition: "none", personGaze: "none", personEmotion: "", personAction: "", scene: item.scene, mood: ["광고용","검수 대기"], elements: [], colors: [], productPosition: "center-right", textSafeArea: "top-left", focalArea: "center", brightness: "medium", contrast: "medium", orientation: "square", sourceType: "ai_generated", sourceName: "OpenAI", sourcePageUrl: "", originalImageUrl: "", licenseUrl: "", authorName: "AdAtlas", generationModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", generationPrompt: prompt, generatedAt: now, reviewed: false, width: 1600, height: 1600, fileSize: buffer.length, hash: createHash("sha256").update(buffer).digest("hex") });
  process.stdout.write(`OK ${id} (관리 화면에서 검수 후 활성화)\n`);
}
await fs.writeFile(metadataPath, `${JSON.stringify(current, null, 2)}\n`);

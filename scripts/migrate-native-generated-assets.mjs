import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const legacyRoot = path.join(root, "public", "generated");
const privateRoot = path.join(root, ".data", "generated");
const legacyJobsRoot = path.join(root, "data", "creative-generation-jobs");
const privateJobsRoot = path.join(root, ".data", "creative-generation", "jobs");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function migrateDirectories() {
  if (!(await exists(legacyRoot))) return 0;
  let moved = 0;
  for (const advertiser of await readdir(legacyRoot, { withFileTypes: true })) {
    if (!advertiser.isDirectory()) continue;
    const advertiserDirectory = path.join(legacyRoot, advertiser.name);
    for (const job of await readdir(advertiserDirectory, { withFileTypes: true })) {
      if (!job.isDirectory()) continue;
      const source = path.join(advertiserDirectory, job.name);
      if (!(await exists(path.join(source, "manifest.json")))) continue;
      const destination = path.join(privateRoot, advertiser.name, job.name);
      if (await exists(destination)) continue;
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
      moved += 1;
    }
  }
  return moved;
}

async function migrateLoosePublicFiles(directory = legacyRoot) {
  if (!(await exists(directory))) return 0;
  let moved = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      moved += await migrateLoosePublicFiles(source);
      continue;
    }
    const relative = path.relative(legacyRoot, source);
    const destination = path.join(privateRoot, "_legacy-public", relative);
    if (await exists(destination)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    moved += 1;
  }
  return moved;
}

function replacePrivatePaths(value) {
  if (typeof value === "string") {
    return value.startsWith(`${legacyRoot}${path.sep}`) ? path.join(privateRoot, path.relative(legacyRoot, value)) : value;
  }
  if (Array.isArray(value)) return value.map(replacePrivatePaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePrivatePaths(item)]));
  }
  return value;
}

async function migrateJobs() {
  if (!(await exists(legacyJobsRoot))) return 0;
  await mkdir(privateJobsRoot, { recursive: true });
  let changed = 0;
  for (const entry of await readdir(legacyJobsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const legacyFile = path.join(legacyJobsRoot, entry.name);
    const privateFile = path.join(privateJobsRoot, entry.name);
    const sourceFile = (await exists(privateFile)) ? privateFile : legacyFile;
    const source = JSON.parse(await readFile(sourceFile, "utf8"));
    const job = replacePrivatePaths(source);
    let touched = sourceFile === legacyFile || JSON.stringify(job) !== JSON.stringify(source);
    if (Array.isArray(job.results)) {
      job.results = job.results.map((result) => {
        if (!result?.nativeCreative?.finalPath) return result;
        const imagePath = `/api/creative-generation/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(result.id)}/image`;
        if (result.imagePath === imagePath) return result;
        touched = true;
        return { ...result, imagePath };
      });
    }
    if (touched) {
      await atomicJson(privateFile, job);
      if (sourceFile === legacyFile) await rename(legacyFile, `${legacyFile}.migrated`);
      changed += 1;
    }
  }
  return changed;
}

const moved = await migrateDirectories();
const looseFiles = await migrateLoosePublicFiles();
const jobs = await migrateJobs();
process.stdout.write(`비공개 저장소로 이동한 생성 결과: ${moved}개\n비공개 저장소로 이동한 기타 공개 파일: ${looseFiles}개\n비공개 저장소로 이동·갱신한 작업 기록: ${jobs}개\n`);

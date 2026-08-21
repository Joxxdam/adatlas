import { promises as fs } from "node:fs";
import path from "node:path";
import type { CreativeArchiveMetadata } from "./types";

type CreativeArchiveMetadataStore = {
  version: "creative-archive-metadata-v1";
  entries: Record<string, CreativeArchiveMetadata>;
};

const emptyStore = (): CreativeArchiveMetadataStore => ({
  version: "creative-archive-metadata-v1",
  entries: {},
});

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((tag) => cleanText(tag, 30)).filter(Boolean))).slice(0, 8);
}

export function createCreativeArchiveMetadataRepository(options: { dataDirectory?: string } = {}) {
  const dataDirectory = options.dataDirectory || path.join(process.cwd(), ".data", "creative-archive");
  const storePath = path.join(dataDirectory, "metadata.json");
  let queue: Promise<void> = Promise.resolve();

  async function readStore(): Promise<CreativeArchiveMetadataStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<CreativeArchiveMetadataStore>;
      return {
        ...emptyStore(),
        ...parsed,
        entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw new Error("아카이브 메모를 불러오지 못했습니다.");
    }
  }

  async function writeStore(store: CreativeArchiveMetadataStore) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporary, storePath);
  }

  function locked<T>(operation: () => Promise<T>) {
    const next = queue.then(operation, operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    async list() {
      return (await readStore()).entries;
    },

    async update(
      entryId: string,
      input: Partial<Pick<CreativeArchiveMetadata, "savedAsReference" | "tags" | "note">>
    ) {
      return locked(async () => {
        const store = await readStore();
        const current = store.entries[entryId];
        const metadata: CreativeArchiveMetadata = {
          entryId,
          savedAsReference:
            typeof input.savedAsReference === "boolean"
              ? input.savedAsReference
              : current?.savedAsReference || false,
          tags: input.tags === undefined ? current?.tags || [] : cleanTags(input.tags),
          note: input.note === undefined ? current?.note || "" : cleanText(input.note, 500),
          updatedAt: new Date().toISOString(),
        };
        store.entries[entryId] = metadata;
        await writeStore(store);
        return metadata;
      });
    },
  };
}

export const creativeArchiveMetadataRepository = createCreativeArchiveMetadataRepository();

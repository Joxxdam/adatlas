import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CreativeContentNote, CreativeContentNoteContext } from "./types.ts";
import { resolveCreativeContentNotes } from "./service.ts";

const filePath = path.join(process.cwd(), "data", "creative-content-notes.json");

async function readAll(): Promise<CreativeContentNote[]> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeAll(notes: CreativeContentNote[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

export const creativeContentNoteRepository = {
  readAll,
  async list(context?: Partial<CreativeContentNoteContext>) {
    const notes = await readAll();
    return context?.advertiserId ? notes.filter((note) => note.advertiserId === context.advertiserId) : notes;
  },
  async resolve(context: CreativeContentNoteContext) {
    return resolveCreativeContentNotes(await readAll(), context);
  },
  async create(input: Omit<CreativeContentNote, "id" | "createdAt" | "updatedAt">) {
    const notes = await readAll();
    const now = new Date().toISOString();
    const note: CreativeContentNote = {
      ...input,
      id: `content-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      categoryId: input.scope === "category" ? input.scopeId : null,
      productId: input.scope === "product" ? input.scopeId : null,
      priority: input.required || input.prohibited ? 100 : input.scope === "product" ? 30 : input.scope === "category" ? 20 : 10,
      isRequired: input.required,
      isActive: input.active,
      validFrom: input.startsAt,
      validTo: input.endsAt,
      createdBy: input.source === "feedback" ? "creative-feedback" : "user",
      createdAt: now,
      updatedAt: now,
    };
    notes.push(note);
    await writeAll(notes);
    return note;
  },
  async update(id: string, updates: Partial<Omit<CreativeContentNote, "id" | "createdAt">>) {
    const notes = await readAll();
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return null;
    notes[index] = { ...notes[index], ...updates, id, updatedAt: new Date().toISOString() };
    await writeAll(notes);
    return notes[index];
  },
  async remove(id: string) {
    const notes = await readAll();
    const next = notes.filter((note) => note.id !== id);
    if (next.length === notes.length) return false;
    await writeAll(next);
    return true;
  },
};

export const CreativeContentNoteRepository = creativeContentNoteRepository;

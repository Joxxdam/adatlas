import { promises as fs } from "fs";
import path from "path";

export class JsonArrayRepository<T> {
  constructor(
    private readonly relativePath: string,
    private readonly normalize?: (record: T) => T
  ) {}

  private get filePath() {
    return path.join(process.cwd(), this.relativePath);
  }

  async read(): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (!Array.isArray(parsed)) return [];
      return this.normalize ? parsed.map((record) => this.normalize?.(record as T) as T) : parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return [];
    }
  }

  async write(records: T[]): Promise<T[]> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    return records;
  }

  async prepend(records: T[], limit?: number): Promise<T[]> {
    const current = await this.read();
    const next = [...records, ...current];
    return this.write(typeof limit === "number" ? next.slice(0, limit) : next);
  }
}

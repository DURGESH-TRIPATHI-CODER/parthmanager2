import fs from "node:fs";
import path from "node:path";

/**
 * Minimal typed JSON file store used for saved column mappings and message
 * templates. One JSON file per collection under the app's userData directory.
 */
export class JsonStore<T> {
  private readonly filePath: string;

  constructor(userDataDir: string, filename: string) {
    this.filePath = path.join(userDataDir, filename);
  }

  read(): T | null {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2), "utf-8");
  }
}

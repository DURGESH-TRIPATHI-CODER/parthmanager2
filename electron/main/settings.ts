import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../shared/types";

/**
 * Tiny JSON settings store. Persisted under the app's userData directory so
 * it survives updates and is per-user (no admin rights needed).
 */
export class SettingsStore {
  private readonly filePath: string;
  private cache: Settings | null = null;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "settings.json");
  }

  get settings(): Settings {
    if (this.cache) return this.cache;
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      this.cache = {
        rootFolder:
          typeof parsed.rootFolder === "string" && parsed.rootFolder.trim() !== ""
            ? parsed.rootFolder
            : null,
      };
    } catch {
      this.cache = { rootFolder: null };
    }
    return this.cache;
  }

  setRootFolder(folder: string | null): void {
    const next: Settings = { ...this.settings, rootFolder: folder };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf-8");
    this.cache = next;
  }
}

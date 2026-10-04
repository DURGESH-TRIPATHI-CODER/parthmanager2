import type { ParthSevaApi } from "../electron/preload/index";
import type { ImportMetaEnv } from "vite";

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    parthseva: ParthSevaApi;
  }
}

export {};

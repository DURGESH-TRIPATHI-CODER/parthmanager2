import type { ParthSevaApi } from "../electron/preload/index";

declare global {
  interface Window {
    parthseva: ParthSevaApi;
  }
}

export {};

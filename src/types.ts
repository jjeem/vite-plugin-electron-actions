import type { Plugin } from "vite";

export interface ElectronActionsOptions {
  /**
   * Glob pattern(s) matched relative to the Vite root.
   * Only matching files are processed and scanned for `"use node"` handlers.
   * Negated patterns prefixed with `!` exclude files.
   * At least one non-negated include pattern is required.
   * Applies to all envs.
   *
   * @default all `.js/.ts/.jsx/.tsx` files under `src/`
   */
  files?: string | readonly string[];
  /**
   * Optional prefix prepended to every IPC channel name.
   * Applies to `main` and `preload` envs.
   *
   * @default ""
   */
  channelPrefix?: string;
}

export interface ElectronActionsPlugins {
  renderer: Plugin;
  main: Plugin;
  preload: Plugin;
}

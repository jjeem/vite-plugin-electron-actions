import type { Plugin } from "vite";

export interface ElectronActionsOptions {
  /**
   * Glob patterns matched relative to the Vite root.
   * Only matching files are processed and scanned for `"use node"` handlers.
   * Negated patterns prefixed with `!` exclude files.
   * At least one non-negated include pattern is required.
   * Applies to all envs.
   */
  files: string[];
  /**
   * Optional prefix prepended to every IPC channel name.
   * Pass an empty string when no prefix is needed.
   *
   * @default "$$electron-actions:"
   */
  channelPrefix?: string;
}

export interface ElectronActionsPlugins {
  renderer: Plugin;
  main: Plugin;
  preload: Plugin;
}

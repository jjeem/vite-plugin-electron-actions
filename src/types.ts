export interface ElectronActionsOptions {
  /**
   * The Electron build environment this plugin instance is for.
   *
   * Register the plugin once per Vite config with the matching env:
   * - `"renderer"` — transforms `"use node"` files into IPC stubs
   * - `"main"`     — generates the `setupMain()` implementation
   * - `"preload"`  — generates the `setupPreload()` implementation
   */
  env: "renderer" | "main" | "preload";
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

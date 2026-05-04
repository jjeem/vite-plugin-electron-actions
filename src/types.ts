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
   * A `RegExp` matched against the absolute file path.
   * Only files that match are processed by the plugin.
   * Applies to the `renderer` env only.
   * When omitted, all `.js/.ts/.jsx/.tsx` files are considered.
   */
  include?: RegExp;
  /**
   * A `RegExp` matched against the absolute file path.
   * Files that match are skipped. Takes precedence over `include`.
   * Applies to the `renderer` env only.
   */
  exclude?: RegExp;
  /**
   * Directories to scan for `"use node"` files when generating
   * `setupMain()` and `setupPreload()`.
   * Applies to `main` and `preload` envs.
   * Paths are relative to the Vite root.
   *
   * @default ["src"]
   */
  scanDirs?: string[];
  /**
   * Optional prefix prepended to every IPC channel name.
   * Applies to `main` and `preload` envs.
   *
   * @default ""
   */
  channelPrefix?: string;
}

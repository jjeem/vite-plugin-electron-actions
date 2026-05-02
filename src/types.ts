export interface ElectronActionsOptions {
  /**
   * A `RegExp` matched against the absolute file path.
   * Only files that match are processed by the plugin.
   * When omitted, all files are considered for transformation.
   */
  include?: RegExp;
  /**
   * A `RegExp` matched against the absolute file path.
   * Files that match are skipped by the plugin entirely.
   * Takes precedence over `include`.
   */
  exclude?: RegExp;
  /**
   * Directories to scan for `"use node"` files when generating
   * the virtual `electron-actions:handlers` module.
   *
   * Paths are relative to the Vite root.
   *
   * @default ["src"]
   */
  scanDirs?: string[];
}

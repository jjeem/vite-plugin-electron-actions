import handlers from "vite-plugin-electron-actions:handlers-map";
import { ipcMain } from "electron";

/**
 * Call this in your Electron main process to register all `ipcMain.handle()`
 * calls for functions marked with `"use node"`.
 *
 * Requires `electronActions({ env: "main" })` in your Vite config.
 */
export function setupMain(): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    try {
      ipcMain.handle(channel, (_event, ...args) => fn(...args));
    } catch (err) {
      if (
        err instanceof Error &&
        err.message
          .toLowerCase()
          .includes("attempted to register a second handler for")
      ) {
        throw new Error(
          `[electron-actions]: "${channel}" is already registered. Ensure you call setupMain() only once in your main process.`,
        );
      }
      throw err;
    }
  }
}

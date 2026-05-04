import handlers from "electron-actions:handlers-map";
import { ipcMain } from "electron";

/**
 * Call this in your Electron main process to register all `ipcMain.handle()`
 * calls for functions marked with `"use node"`.
 *
 * Requires `electronActions({ env: "main" })` in your Vite config.
 */
export function setupMain(): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => fn(...args));
  }
}

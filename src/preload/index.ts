import channels from "electron-actions:channels";
import { contextBridge, ipcRenderer } from "electron";

declare global {
  interface Window {
    __ea: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }
}

/**
 * Call this in your preload script to expose all `"use node"` functions
 * to the renderer via contextBridge, each locked to its own IPC channel.
 *
 * Requires `electronActions({ env: "preload" })` in your Vite config.
 */
export function setupPreload(): void {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const channel of channels) {
    api[channel] = (...args) => ipcRenderer.invoke(channel, ...args);
  }
  contextBridge.exposeInMainWorld("__ea", api);
}

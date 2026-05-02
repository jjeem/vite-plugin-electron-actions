import { channels } from "electron-actions:preload";
import type { ContextBridge, IpcRenderer } from "electron";

declare global {
  interface Window {
    __ea: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }
}

/**
 * Call this in your preload script to expose individual named IPC
 * functions via contextBridge. Each function is locked to a single
 * pre-determined channel — the renderer cannot invoke arbitrary channels.
 */
export function createElectronActionsRenderer(
  contextBridge: ContextBridge,
  ipcRenderer: IpcRenderer,
): void {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const [fnName, channel] of Object.entries(channels)) {
    api[fnName] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }

  contextBridge.exposeInMainWorld("__ea", api);
}

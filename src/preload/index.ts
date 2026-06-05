import channels from "vite-plugin-electron-actions:channels";
import { contextBridge, ipcRenderer } from "electron";

declare global {
  interface Window {
    $$vitePluginElectronActions: Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    $$mainSetupPromise: (callback: (result: boolean) => void) => void;
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
  contextBridge.exposeInMainWorld("$$vitePluginElectronActions", api);
  contextBridge.exposeInMainWorld(
    "$$mainSetupPromise",
    async (callback: (result: boolean) => void) => {
      ipcRenderer.on("$$electron-actions:main-setup-complete", (_, result) => {
        callback(result);
      });
    },
  );
}

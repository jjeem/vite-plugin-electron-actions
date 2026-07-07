import channelPrefix from "vite-plugin-electron-actions:channel-prefix";
import channels from "vite-plugin-electron-actions:channels";
import { contextBridge, ipcRenderer } from "electron";

declare global {
  interface Window {
    $$vitePluginElectronActions: Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    $$onMainSetupComplete: (callback: (result: boolean) => void) => void;
  }
}

/**
 * Call this in your preload script to expose all `"use node"` functions
 * to the renderer via contextBridge, each locked to its own IPC channel.
 *
 * Requires the `preload` plugin from `electronActions()` in your Vite config.
 */
export function setupPreload(): void {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const mainSetupCompleteEvent = `${channelPrefix}main-setup-complete`;
  for (const channel of channels) {
    api[channel] = (...args) => ipcRenderer.invoke(channel, ...args);
  }
  contextBridge.exposeInMainWorld("$$vitePluginElectronActions", api);
  contextBridge.exposeInMainWorld(
    "$$onMainSetupComplete",
    async (callback: (result: boolean) => void) => {
      ipcRenderer.on(mainSetupCompleteEvent, (_, result) => {
        callback(result);
      });
    },
  );
}

import channelPrefix from "vite-plugin-electron-actions:channel-prefix";
import channels from "vite-plugin-electron-actions:channels";
import { contextBridge, ipcRenderer } from "electron";

interface PreloadApi {
  [key: string]: unknown;
  onMainSetupComplete(callback: () => void): () => void;
}

/**
 * Call this in your preload script to expose all `"use node"` functions
 * to the renderer via contextBridge, each locked to its own IPC channel.
 *
 * Requires the `preload` plugin from `electronActions()` in your Vite config.
 */
export function setupPreload(): void {
  const mainSetupCompleteEvent = `${channelPrefix}main-setup-complete`;
  const api: PreloadApi = {
    onMainSetupComplete(callback) {
      const listener = () => callback();

      ipcRenderer.on(mainSetupCompleteEvent, listener);

      return () => {
        ipcRenderer.removeListener(mainSetupCompleteEvent, listener);
      };
    },
  };
  for (const channel of channels) {
    api[channel] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }
  contextBridge.exposeInMainWorld("$$vitePluginElectronActions", api);
}

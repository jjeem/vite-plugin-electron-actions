import type { BrowserWindow } from "electron";

export type { ElectronActionContext } from "./action-context.js";
export {
  $$vitePluginElectronActions_runAction,
  getActionContext,
} from "./action-context.js";

let res: (value: true) => void;
let rej: (reason?: unknown) => void;

/**
 * Resolves when all `ipcMain.handle()` registrations from `"use node"`
 * functions are complete.
 *
 * Equivalent to the promise returned by `setupMain()`.
 */
export const mainSetupPromise: Promise<true> = new Promise<true>(
  (resolve, reject) => {
    res = resolve;
    rej = reject;
  },
);

/**
 * Sends the main-setup-complete event to a list of BrowserWindows.
 * Waits for `mainSetupPromise` to resolve and for each window's webContents
 * to finish loading before sending.
 */
export async function notifyWindows(windows: BrowserWindow[]): Promise<void> {
  const result = await mainSetupPromise;
  const promises = windows.map((win) => {
    return new Promise<void>((resolve) => {
      const send = () => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(
            "$$electron-actions:main-setup-complete",
            result,
          );
        }
        resolve();
      };

      const skip = () => {
        resolve();
      };

      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        skip();
        return;
      }

      if (!win.webContents.isLoading()) {
        send();
        return;
      }

      win.webContents.once("did-finish-load", send);
      win.webContents.once("did-fail-load", skip);
      win.webContents.once("destroyed", skip);
    });
  });

  await Promise.all(promises);
}

export interface SetupMainOptions {
  /**
   * BrowserWindows to notify once all handlers are registered.
   * Each window will receive the `$$electron-actions:main-setup-complete`
   * event after its webContents finishes loading.
   */
  windows?: BrowserWindow[];
}

/**
 * Call this in your Electron main process to register all `ipcMain.handle()`
 * calls for functions marked with `"use node"`.
 *
 * Requires `electronActions({ env: "main" })` in your Vite config.
 *
 * Returns a promise that resolves once all handlers are registered.
 * The same promise is available as the exported `mainSetupPromise`.
 */
export async function setupMain(options: SetupMainOptions = {}): Promise<true> {
  import("vite-plugin-electron-actions:load-handlers")
    .then(() => {
      res(true);
    })
    .catch((error) => {
      console.error(
        "[vite-plugin-electron-actions] Error loading handlers: ",
        error,
      );
      rej(error);
    });

  if (options.windows && options.windows.length > 0) {
    await notifyWindows(options.windows);
  }

  return mainSetupPromise;
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { IpcMainInvokeEvent } from "electron";

export interface ElectronActionContext {
  event: IpcMainInvokeEvent;
}

const actionContextStorage = new AsyncLocalStorage<ElectronActionContext>();

export function getActionContext(): ElectronActionContext {
  const context = actionContextStorage.getStore();
  if (!context) {
    throw new Error(
      `[vite-plugin-electron-actions] getActionContext() can only be called while a "use node" action is running.`,
    );
  }

  return context;
}

export function $$vitePluginElectronActions_runAction<T>(
  event: IpcMainInvokeEvent,
  action: () => T,
): T {
  return actionContextStorage.run({ event }, action);
}

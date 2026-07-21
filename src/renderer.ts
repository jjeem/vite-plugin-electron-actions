interface ElectronActionsBridge {
  onMainSetupComplete(callback: () => void): () => void;
}

interface ElectronActionsWindow extends Window {
  $$vitePluginElectronActions: ElectronActionsBridge;
}

/**
 * Registers a callback that runs after all main-process action handlers are
 * ready.
 * @returns a unsubscribe function that removes the listener.
 */
export function onMainSetupComplete(callback: () => void): () => void {
  const api = (window as unknown as ElectronActionsWindow)
    .$$vitePluginElectronActions;
  return api.onMainSetupComplete(callback);
}

/**
 * Generate code for the `vite-plugin-electron-actions:channels` virtual module.
 *
 * Produces a default export of `[channelString, ...]` consumed by
 * `setupPreload()` in `src/preload.ts`. The full channel string
 * (including any prefix) is used as both the
 * `window.$$vitePluginElectronActions` key and the
 * `ipcRenderer.invoke` argument, keeping the two in sync automatically.
 *
 * Throws on duplicate channel strings (hash collision guard).
 */
export function generateChannelsModule(
  registry: Map<string, string[]>,
): string {
  if (registry.size === 0) return "export default [];";

  const seen = new Set<string>();
  const entries: string[] = [];

  for (const channels of registry.values()) {
    for (const channel of channels) {
      if (seen.has(channel)) {
        throw new Error(
          `[vite-plugin-electron-actions] Channel collision detected: "${channel}". This should never happen — please file a bug.`,
        );
      }
      seen.add(channel);
      entries.push(`  ${JSON.stringify(channel)},`);
    }
  }

  return ["export default [", ...entries, "];"].join("\n");
}

/**
 * Generate code for the `vite-plugin-electron-actions:load-handlers` virtual module.
 *
 * Produces a list of side-effect imports — one per handler file. Importing
 * this module causes every `"use node"` file to be loaded, which triggers
 * the `ipcMain.handle()` calls that the plugin injects directly into each
 * file via `transformForMain()`.
 */
export function generateHandlersLoaderModule(
  registry: Map<string, string[]>,
): string {
  if (registry.size === 0) return "";

  return [...registry.keys()]
    .map((filePath) => `import ${JSON.stringify(filePath)}`)
    .join("\n");
}

export function generateChannelPrefixModule(channelPrefix: string): string {
  return `export default ${JSON.stringify(channelPrefix)};`;
}

// ── IPC invoker generators ─────────────────────────────────────

export function ipcInvokerFn(name: string, key: string): string {
  return `async function ${name}(...args) {
  return await window.$$vitePluginElectronActions[${JSON.stringify(key)}](...args);
}`;
}

export function ipcInvokerArrow(name: string, key: string): string {
  return `const ${name} = async (...args) => {
  return await window.$$vitePluginElectronActions[${JSON.stringify(key)}](...args);
}`;
}

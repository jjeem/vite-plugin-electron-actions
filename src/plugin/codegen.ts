/**
 * Generate code for the `vite-plugin-electron-actions:channels` virtual module.
 *
 * Produces a default export of `[channelString, ...]` consumed by
 * `setupPreload()` in `src/preload/index.ts`. The full channel string
 * (including any prefix) is used as both the `window.__ea` key and the
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
 * Generate code for the `vite-plugin-electron-actions:handlers-map` virtual module.
 *
 * Produces a default export of `{ [channelString]: handlerFn }` consumed by
 * `setupMain()` in `src/main/index.ts`.
 *
 * @param registry - Map of absolute file path → channel strings
 * @param resolveImport - Returns the import specifier for a given file path
   *   (allows the caller to inject `vite-plugin-electron-actions:non-exported-actions:` when needed)
 */
export function generateHandlersMapModule(
  registry: Map<string, string[]>,
  resolveImport: (filePath: string) => string,
): string {
  if (registry.size === 0) return "export default {};";

  const imports: string[] = [];
  const entries: string[] = [];
  let counter = 0;

  for (const [fileId, channels] of registry) {
    const ns = `_ea${counter++}`;
    imports.push(
      `import * as ${ns} from ${JSON.stringify(resolveImport(fileId))};`,
    );

    for (const channel of channels) {
      const fnName = channel.slice(channel.lastIndexOf(":") + 1);
      entries.push(
        `  ${JSON.stringify(channel)}: ${ns}[${JSON.stringify(fnName)}],`,
      );
    }
  }

  return [...imports, "", "export default {", ...entries, "};"].join("\n");
}

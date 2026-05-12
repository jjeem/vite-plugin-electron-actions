/**
 * Generate code for the `electron-actions:channels` virtual module.
 *
 * Produces a default export of `{ [key]: channelString }` consumed by
 * `setupPreload()` in `src/preload/index.ts`.
 *
 * The key is the channel string with the prefix stripped (`"<hash>:<fnName>"`),
 * so two functions with the same name in different files never collide in
 * `window.__ea`, and the prefix is not exposed to the renderer.
 */
export function generateChannelsModule(
  registry: Map<string, string[]>,
  channelPrefix = "",
): string {
  if (registry.size === 0) return "export default {};";

  const entries: string[] = [];
  for (const channels of registry.values()) {
    for (const channel of channels) {
      const key = channel.slice(channelPrefix.length);
      entries.push(`  ${JSON.stringify(key)}: ${JSON.stringify(channel)},`);
    }
  }

  return ["export default {", ...entries, "};"].join("\n");
}

/**
 * Generate code for the `electron-actions:handlers-map` virtual module.
 *
 * Produces a default export of `{ [channelString]: handlerFn }` consumed by
 * `setupMain()` in `src/main/index.ts`.
 *
 * @param registry - Map of absolute file path → channel strings
 * @param resolveImport - Returns the import specifier for a given file path
 *   (allows the caller to inject `electron-actions:non-exported-actions:` when needed)
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

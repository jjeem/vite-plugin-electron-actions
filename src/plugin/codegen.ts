import type { DiscoveredAction } from "./channel.js";

/**
 * Generate code for the `electron-actions:channels` virtual module.
 *
 * Produces a default export of `{ [actionId]: channelString }` consumed by
 * `setupPreload()` in `src/preload/index.ts`.
 *
 * Using the actionId (not the raw function name) as the key eliminates
 * preload collisions when multiple handlers share the same function name
 * across files or within the same file.
 */
export function generateChannelsModule(
  registry: Map<string, DiscoveredAction[]>,
): string {
  if (registry.size === 0) return "export default {};";

  const entries: string[] = [];
  for (const actions of registry.values()) {
    for (const action of actions) {
      entries.push(
        `  ${JSON.stringify(action.actionId)}: ${JSON.stringify(action.channel)},`,
      );
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
 * @param registry - Map of absolute file path → discovered actions
 * @param resolveImport - Returns the import specifier for a given file path
 *   (allows the caller to inject `electron-actions:non-exported-actions:` when needed)
 */
export function generateHandlersMapModule(
  registry: Map<string, DiscoveredAction[]>,
  resolveImport: (filePath: string) => string,
): string {
  if (registry.size === 0) return "export default {};";

  const imports: string[] = [];
  const entries: string[] = [];
  let counter = 0;

  for (const [fileId, actions] of registry) {
    const ns = `_ea${counter++}`;
    imports.push(
      `import * as ${ns} from ${JSON.stringify(resolveImport(fileId))};`,
    );

    for (const action of actions) {
      entries.push(
        `  ${JSON.stringify(action.channel)}: ${ns}[${JSON.stringify(action.functionName)}],`,
      );
    }
  }

  return [...imports, "", "export default {", ...entries, "};"].join("\n");
}

/**
 * Generate code for the virtual `electron-actions:preload` module.
 *
 * Exports a `channels` map of { [fnName]: channelString } so the
 * preload script can expose individual named functions via contextBridge
 * without leaking channel strings to the renderer.
 */
export function generatePreloadModule(registry: Map<string, string[]>): string {
  const entries: string[] = [];

  for (const channels of registry.values()) {
    for (const channel of channels) {
      const fnName = channel.slice(channel.lastIndexOf(":") + 1);
      entries.push(`  ${JSON.stringify(fnName)}: ${JSON.stringify(channel)}`);
    }
  }

  if (entries.length === 0) {
    return "export const channels = {};\n";
  }

  return `export const channels = {\n${entries.join(",\n")},\n};\n`;
}

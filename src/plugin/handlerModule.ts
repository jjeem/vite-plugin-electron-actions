const RAW_PREFIX = "ea-raw:";

/**
 * Generate code for the virtual `electron-actions:handlers` module.
 *
 * Re-imports the original (untransformed) source files via the
 * `ea-raw:` prefix so the real function bodies execute in Node.js.
 */
export function generateHandlerModule(registry: Map<string, string[]>): string {
  if (registry.size === 0) {
    return "// electron-actions: no handlers registered\n";
  }

  const imports: string[] = [];
  const registrations: string[] = [];
  let aliasCounter = 0;

  for (const [fileId, handlers] of registry) {
    const ns = `_ea${aliasCounter++}`;
    imports.push(`import * as ${ns} from "${RAW_PREFIX}${fileId}";`);

    for (const channel of handlers) {
      // channel is "src/path/file:funcName" — split off the function name for the ns lookup
      const funcName = channel.slice(channel.lastIndexOf(":") + 1);
      registrations.push(
        `ipcMain.handle(${JSON.stringify(channel)}, (_event, ...args) => ${ns}[${JSON.stringify(funcName)}](...args));`,
      );
    }
  }

  return [
    `import { ipcMain } from "electron";`,
    "",
    ...imports,
    "",
    ...registrations,
    "",
  ].join("\n");
}

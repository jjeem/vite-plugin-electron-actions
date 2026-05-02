import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { Plugin, ResolvedConfig } from "vite";
import { createFilter } from "vite";
import { generateHandlerModule } from "./plugin/handlerModule.js";
import { generatePreloadModule } from "./plugin/preloadModule.js";
import {
  extractNonExportedHandlerNames,
  scanForHandlers,
  transform,
} from "./plugin/transform.js";
import type { ElectronActionsOptions } from "./types.js";

const HANDLERS_MODULE_ID = "electron-actions:handlers";
const RESOLVED_HANDLERS_ID = "\0electron-actions:handlers";
const PRELOAD_MODULE_ID = "electron-actions:preload";
const RESOLVED_PRELOAD_ID = "\0electron-actions:preload";
const RAW_PREFIX = "ea-raw:";
const RESOLVED_RAW_PREFIX = "\0ea-raw:";

export function electronActions(options: ElectronActionsOptions = {}): Plugin {
  const includePattern = options.include ?? /\.[jt]sx?$/;
  const filter = createFilter(includePattern, options.exclude);
  const scanDirs = options.scanDirs ?? ["src"];

  let root = process.cwd();

  // fileId → handler names collected during renderer transform
  const handlerRegistry = new Map<string, string[]>();

  return {
    name: "electron-actions",

    configResolved(config: ResolvedConfig) {
      root = config.root;
    },

    resolveId(id, importer) {
      if (id === HANDLERS_MODULE_ID) {
        return RESOLVED_HANDLERS_ID;
      }

      if (id === PRELOAD_MODULE_ID) {
        return RESOLVED_PRELOAD_ID;
      }

      if (id.startsWith(RAW_PREFIX)) {
        return RESOLVED_RAW_PREFIX + id.slice(RAW_PREFIX.length);
      }

      // Resolve relative imports coming from ea-raw: files so that
      // transitive imports (e.g. counter.ts importing ./api) stay
      // within the raw module graph and Rolldown can find them.
      if (importer?.startsWith(RESOLVED_RAW_PREFIX) && id.startsWith(".")) {
        const importerPath = importer.slice(RESOLVED_RAW_PREFIX.length);
        const resolved = path.resolve(path.dirname(importerPath), id);
        // Try common extensions if no extension given
        const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
        for (const ext of extensions) {
          const candidate = resolved + ext;
          try {
            readFileSync(candidate);
            return RESOLVED_RAW_PREFIX + candidate;
          } catch {
            // try next
          }
        }
        return RESOLVED_RAW_PREFIX + resolved;
      }

      return null;
    },

    load(id) {
      if (id === RESOLVED_HANDLERS_ID) {
        // Scan filesystem for handlers — works in both renderer
        // and main process build contexts
        const scanned = scanForHandlers(scanDirs, root);

        // Merge with any handlers discovered during transform
        for (const [fileId, handlers] of handlerRegistry) {
          if (!scanned.has(fileId)) {
            scanned.set(fileId, handlers);
          }
        }

        return generateHandlerModule(scanned);
      }

      if (id === RESOLVED_PRELOAD_ID) {
        const scanned = scanForHandlers(scanDirs, root);

        for (const [fileId, handlers] of handlerRegistry) {
          if (!scanned.has(fileId)) {
            scanned.set(fileId, handlers);
          }
        }

        return generatePreloadModule(scanned);
      }

      if (id.startsWith(RESOLVED_RAW_PREFIX)) {
        const filePath = id.slice(RESOLVED_RAW_PREFIX.length);
        const code = readFileSync(filePath, "utf-8");

        // Parse and find any non-exported "use node" functions.
        // They need to be re-exported so ipcMain.handle() can reference them
        // via `import * as ns from "ea-raw:..."`.
        const { program } = parseSync(filePath, code);
        const nonExported = extractNonExportedHandlerNames(program);

        if (nonExported.length === 0) return code;

        const reExports = nonExported
          .map((name) => `export { ${name} }`)
          .join("\n");
        return `${code}\n${reExports}\n`;
      }

      return null;
    },

    transform: {
      filter: {
        id: includePattern,
      },
      handler(code, id) {
        // Guard retained for backward compatibility with Vite < 6.3 / Rollup < 4.38
        // where hook filters are not supported and all files reach this handler.
        if (id.startsWith(RESOLVED_RAW_PREFIX)) return null;
        if (!filter(id)) return null;

        const result = transform(code, id);
        if (!result) return null;

        if (result.handlers.length > 0) {
          handlerRegistry.set(id, result.handlers);
        }

        return {
          code: result.code,
          map: null,
        };
      },
    },
  };
}

export type { ElectronActionsOptions } from "./types.js";

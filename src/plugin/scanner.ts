import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { channelName } from "./channel.js";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
} from "./directives.js";
import { extractHandlerNames } from "./handlers.js";

// ── Filesystem scanner ─────────────────────────────────────────

const FILE_REGEX = /\.[jt]sx?$/;

function walkDir(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkDir(full));
      } else if (FILE_REGEX.test(entry)) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

/**
 * Scan directories on disk for files containing `"use node"` directives
 * and return a map of absolute file paths to IPC channel names.
 *
 * This is used by the virtual module `load` hook so the main process
 * build can discover handlers without relying on the renderer's
 * `transform` pass having run first.
 */
export function scanForHandlers(
  dirs: string[],
  root: string,
  prefix = "",
): Map<string, string[]> {
  const registry = new Map<string, string[]>();

  for (const dir of dirs) {
    const absDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
    const files = walkDir(absDir);

    for (const filePath of files) {
      let code: string;
      try {
        code = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const { program } = parseSync(filePath, code);
      const isFileLevel = checkFileLevelDirective(program);
      const isFunctionLevel = checkFunctionLevelDirective(program);

      if (!isFileLevel && !isFunctionLevel) continue;

      const funcNames = extractHandlerNames(program, isFileLevel);
      const channels = funcNames.map((n) => channelName(filePath, n, prefix));
      if (channels.length > 0) {
        registry.set(filePath, channels);
      }
    }
  }

  return registry;
}

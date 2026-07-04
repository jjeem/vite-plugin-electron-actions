import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import { globSync } from "tinyglobby";
import { channelName } from "./channel.js";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
} from "./directives.js";
import { splitFilePatterns } from "./files.js";
import { extractHandlerNames } from "./handlers.js";

// ── Filesystem scanner ─────────────────────────────────────────

/**
 * Scan files on disk for files containing `"use node"` directives
 * and return a map of absolute file paths to IPC channel names.
 *
 * This is used by the virtual module `load` hook so the main process
 * build can discover handlers without relying on the renderer's
 * `transform` pass having run first.
 */
export function scanForHandlers(
  files: string[],
  root: string,
  prefix = "",
): Map<string, string[]> {
  const registry = new Map<string, string[]>();
  const { include, exclude } = splitFilePatterns(files);

  const filePaths = globSync(include, {
    absolute: true,
    cwd: root,
    dot: true,
    ignore: exclude,
    onlyFiles: true,
  }).sort();

  for (const filePath of filePaths) {
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

  return registry;
}

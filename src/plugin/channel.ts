import { createHash } from "node:crypto";

// ── Channel naming ─────────────────────────────────────────────

/**
 * A discovered action with all derived identifiers.
 *
 * - `functionName` — the original JS identifier (used to access the module
 *   namespace binding in the main-process handlers map).
 * - `actionId` — a unique, stable key used as the preload bridge key and the
 *   renderer-side `window.__ea[actionId]` accessor. Derived from a hash of the
 *   file path, the function name, and the source byte offset so that two
 *   same-named handlers in the same file still produce distinct IDs.
 * - `channel` — the IPC channel string registered with `ipcMain.handle()` and
 *   invoked by `ipcRenderer.invoke()`. Incorporates the optional `channelPrefix`.
 * - `start` — the AST byte offset of the function/variable-declarator node;
 *   used as the discriminator that differentiates same-named handlers.
 */
export interface DiscoveredAction {
  functionName: string;
  actionId: string;
  channel: string;
  start: number;
}

/**
 * Compute the unique action ID for a handler.
 *
 * Format: `"<funcName>__<8-char-file-path-hash>_<start>"`
 * e.g. `getUser__a3f2b1c4_127`
 *
 * The file-path hash distinguishes same-named handlers across files.
 * The start byte offset distinguishes same-named handlers within a file.
 * The prefix is intentionally excluded so the renderer stub (which has no
 * knowledge of the configured channelPrefix) produces the same key.
 */
export function makeActionId(
  filePath: string,
  funcName: string,
  start: number,
): string {
  const pathHash = createHash("sha1")
    .update(filePath)
    .digest("hex")
    .slice(0, 8);
  return `${funcName}__${pathHash}_${start}`;
}

/**
 * Derive a collision-free IPC channel name from an absolute file path,
 * function name, and the handler's byte offset within the source file.
 *
 * Format: `"[prefix]<8-char-sha1-hex>:<funcName>"`
 * e.g. `/abs/root/src/users/api.ts` + `getUser` + `127` → `"a3f2b1c4:getUser"`
 *
 * The hash is over `filePath + ":" + funcName + ":" + start` so two functions
 * with the same name in the same file at different positions never collide.
 *
 * An optional `prefix` is prepended verbatim to the channel string.
 */
export function channelName(
  filePath: string,
  funcName: string,
  start: number,
  prefix = "",
): string {
  const hash = createHash("sha1")
    .update(`${filePath}:${funcName}:${start}`)
    .digest("hex")
    .slice(0, 8);
  return `${prefix}${hash}:${funcName}`;
}

/**
 * Build a complete {@link DiscoveredAction} from raw handler metadata.
 *
 * Convenience factory that derives both `actionId` and `channel` in one call.
 */
export function makeDiscoveredAction(
  filePath: string,
  funcName: string,
  start: number,
  prefix = "",
): DiscoveredAction {
  return {
    functionName: funcName,
    actionId: makeActionId(filePath, funcName, start),
    channel: channelName(filePath, funcName, start, prefix),
    start,
  };
}

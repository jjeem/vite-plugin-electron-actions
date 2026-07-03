import { createHash } from "node:crypto";

// ── Channel naming ─────────────────────────────────────────────

/**
 * Derive a collision-free IPC channel name from an absolute file path
 * and function name.
 *
 * Format: `"[prefix]<12-char-sha1-hex>:<funcName>"`
 * e.g. `/abs/root/src/users/api.ts` + `getUser` → `"a3f2b1c4d5e6:getUser"`
 *
 * The hash is over `filePath + ":" + funcName` so two functions with
 * the same name in different files never collide.
 *
 * An optional `prefix` is prepended verbatim to the channel string,
 * which is useful when multiple plugin instances need isolated handler
 * sets (e.g. separate renderer windows).
 */
export function channelName(
  filePath: string,
  funcName: string,
  prefix = "",
): string {
  const hash = createHash("sha1")
    .update(`${filePath}:${funcName}`)
    .digest("hex")
    .slice(0, 12);
  return `${prefix}${hash}:${funcName}`;
}

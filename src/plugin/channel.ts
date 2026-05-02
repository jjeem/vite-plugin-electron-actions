import { createHash } from "node:crypto";

// ── Channel naming ─────────────────────────────────────────────

/**
 * Derive a collision-free IPC channel name from an absolute file path
 * and function name.
 *
 * Format: `"<8-char-sha1-hex>:<funcName>"`
 * e.g. `/abs/root/src/users/api.ts` + `getUser` → `"a3f2b1c4:getUser"`
 *
 * The hash is over `filePath + ":" + funcName` so two functions with
 * the same name in different files never collide.
 */
export function channelName(filePath: string, funcName: string): string {
  const hash = createHash("sha1")
    .update(`${filePath}:${funcName}`)
    .digest("hex")
    .slice(0, 8);
  return `${hash}:${funcName}`;
}

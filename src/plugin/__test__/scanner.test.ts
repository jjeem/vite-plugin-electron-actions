import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateChannelsModule,
  generateHandlersLoaderModule,
} from "../codegen.ts";
import { scanForHandlers } from "../scanner.ts";

describe("channelPrefix integration", () => {
  const setup = (onTestFinished: (fn: () => void) => void) => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "ea-test-"));
    onTestFinished(() => rmSync(tmpDir, { recursive: true, force: true }));
    const srcDir = path.join(tmpDir, "src");
    mkdirSync(srcDir);
    writeFileSync(
      path.join(srcDir, "api.ts"),
      `"use node";\nexport async function getUser() { return {}; }\n`,
    );
    return { root: tmpDir };
  };

  test("channelPrefix flows through scanForHandlers → generateHandlersLoaderModule (main env)", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);
    const prefix = "my-app:";
    const registry = scanForHandlers(["src"], root, prefix);
    const result = generateHandlersLoaderModule(registry);
    for (const filePath of registry.keys()) {
      expect(result).toContain(`"${filePath}"`);
    }
  });

  test("channelPrefix flows through scanForHandlers → generateChannelsModule (preload env)", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);
    const prefix = "my-app:";
    const registry = scanForHandlers(["src"], root, prefix);
    const result = generateChannelsModule(registry);
    for (const channels of registry.values()) {
      for (const channel of channels) {
        expect(channel.startsWith(prefix)).toBe(true);
        expect(result).toContain(`"${channel}"`);
      }
    }
  });
});

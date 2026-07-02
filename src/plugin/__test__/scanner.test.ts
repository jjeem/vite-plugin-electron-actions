import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateChannelsModule,
  generateHandlersLoaderModule,
} from "../codegen.ts";
import { scanForHandlers } from "../scanner.ts";

describe("scanForHandlers", () => {
  const setup = (onTestFinished: (fn: () => void) => void) => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "ea-test-"));
    onTestFinished(() => rmSync(tmpDir, { recursive: true, force: true }));
    const srcDir = path.join(tmpDir, "src");
    mkdirSync(srcDir);
    const apiFile = path.join(srcDir, "api.ts");
    writeFileSync(
      apiFile,
      `"use node";\nexport async function getUser() { return {}; }\n`,
    );
    return { apiFile, root: tmpDir, srcDir };
  };

  test("discovers handlers from matching glob patterns", ({
    onTestFinished,
  }) => {
    const { apiFile, root } = setup(onTestFinished);
    const registry = scanForHandlers("src/api.ts", root);

    expect([...registry.keys()]).toEqual([apiFile]);
  });

  test("ignores files outside matching glob patterns", ({ onTestFinished }) => {
    const { apiFile, root } = setup(onTestFinished);
    const registry = scanForHandlers("src/missing.ts", root);

    expect([...registry.keys()]).not.toContain(apiFile);
    expect(registry.size).toBe(0);
  });

  test("honors negated glob patterns", ({ onTestFinished }) => {
    const { apiFile, root, srcDir } = setup(onTestFinished);
    writeFileSync(
      path.join(srcDir, "api.test.ts"),
      `"use node";\nexport async function getTestUser() { return {}; }\n`,
    );

    const registry = scanForHandlers(
      ["src/**/*.ts", "!src/**/*.test.ts"],
      root,
    );

    expect([...registry.keys()]).toEqual([apiFile]);
  });

  test("throws when files has no include glob patterns", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);

    expect(() => scanForHandlers(["!src/**/*.ts"], root)).toThrow(
      "files must include at least one glob pattern",
    );
  });

  test("channelPrefix flows through scanForHandlers → generateHandlersLoaderModule (main env)", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);
    const prefix = "my-app:";
    const registry = scanForHandlers("src/**/*.ts", root, prefix);
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
    const registry = scanForHandlers("src/**/*.ts", root, prefix);
    const result = generateChannelsModule(registry);
    for (const channels of registry.values()) {
      for (const channel of channels) {
        expect(channel.startsWith(prefix)).toBe(true);
        expect(result).toContain(`"${channel}"`);
      }
    }
  });
});

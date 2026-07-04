import { parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { channelName } from "../channel.ts";
import {
  generateChannelPrefixModule,
  generateChannelsModule,
  generateHandlersLoaderModule,
} from "../codegen.ts";

describe("generateChannelsModule", () => {
  test("empty registry produces an empty default export", () => {
    const result = generateChannelsModule(new Map());
    expect(result).toBe("export default [];");
  });

  test("generates a channel array entry for a single handler", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(`"${channel}"`);
  });

  test("full channel (including prefix) is in the array", () => {
    const prefix = "app:";
    const channel = channelName("/src/api.ts", "getData", prefix);
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(`"${channel}"`);
  });

  test("escapes channel strings as JavaScript string literals", () => {
    const channel = channelName("/src/api.ts", "getData", 'app"\\dev:\n');
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(JSON.stringify(channel));
    expect(() => parseSync("channels.ts", result)).not.toThrow();
  });

  test("throws on duplicate channel strings", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel, channel]]]);
    expect(() => generateChannelsModule(registry)).toThrow(/collision/);
  });
});

describe("generateHandlersLoaderModule", () => {
  test("empty registry produces empty string", () => {
    const result = generateHandlersLoaderModule(new Map());
    expect(result).toBe("");
  });

  test("generates a side-effect import for a single file", () => {
    const registry = new Map([["/src/api.ts", ["ch:getUser"]]]);
    const result = generateHandlersLoaderModule(registry);
    expect(result).toBe(`import "/src/api.ts"`);
  });

  test("escapes imported file paths as JavaScript string literals", () => {
    const filePath = '/src/app"dev/api.ts';
    const registry = new Map([[filePath, ["ch:getUser"]]]);
    const result = generateHandlersLoaderModule(registry);
    expect(result).toBe(`import ${JSON.stringify(filePath)}`);
    expect(() => parseSync("load-handlers.ts", result)).not.toThrow();
  });

  test("generates one import per file", () => {
    const registry = new Map([
      ["/src/users.ts", ["ch:getUser"]],
      ["/src/posts.ts", ["ch:getPost"]],
    ]);
    const result = generateHandlersLoaderModule(registry);
    expect(result).toContain(`import "/src/users.ts"`);
    expect(result).toContain(`import "/src/posts.ts"`);
  });

  test("does not include channel strings — those live in the transformed files", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateHandlersLoaderModule(registry);
    expect(result).not.toContain(channel);
  });
});

describe("generateChannelPrefixModule", () => {
  test("generates the configured channel prefix", () => {
    expect(generateChannelPrefixModule("my-app:")).toBe(
      'export default "my-app:";',
    );
  });

  test("escapes the channel prefix as a JavaScript string literal", () => {
    const result = generateChannelPrefixModule('app"\\dev:\n');
    expect(result).toContain(JSON.stringify('app"\\dev:\n'));
    expect(() => parseSync("channel-prefix.ts", result)).not.toThrow();
  });
});

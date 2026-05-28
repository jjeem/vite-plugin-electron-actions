import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { collectIdentifierPositions } from "../plugin/ast.ts";
import { channelName } from "../plugin/channel.ts";
import {
  generateChannelsModule,
  generateHandlersLoaderModule,
} from "../plugin/codegen.ts";
import { scanForHandlers } from "../plugin/scanner.ts";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
  transform,
  transformFileLevelDirective,
  transformForMain,
  transformFunctionLevelDirective,
} from "../plugin/transform.ts";

// Use a fixed absolute file path so channel names are deterministic.
const FILE = "/file.ts";

const rendererIpcCall = (name: string) =>
  `window.__ea[${JSON.stringify(channelName(FILE, name))}](...args)`;

describe("transform", () => {
  describe("file top-level directive", () => {
    test("identify top-level directive", async () => {
      const input = `
      "use node";
      
      export function getObject() {
        return {
          a: 1,
          b: true,
        }
      }
      `;

      const { program } = await parse("test.ts", input);
      expect(checkFileLevelDirective(program)).toEqual(true);
    });

    test("does not confuse function-level directive with top-level directive", async () => {
      const input = `
      export function getObject() {
        "use node";
        
        return {
          a: 1,
          b: true,
        }
      }
      `;

      const { program } = await parse("test.ts", input);
      expect(checkFileLevelDirective(program)).toEqual(false);
    });

    test("must return false when top-level directive is not at the top", async () => {
      const input = `
      import { something } from "somewhere";
      "use node";

      export function getObject() {
        return {
          a: 1,
          b: true,
        }
      }
      `;

      const { program } = await parse("test.ts", input);
      expect(checkFileLevelDirective(program)).toEqual(false);
    });

    test("transform file-level that has no imported modules", () => {
      const input = `
"use node";

const uselessVar = 12;

export async function getObject() {
  return {
    a: 1,
    b: true,
  }
}

export const sum = async (a, b) => {
  return a + b;
}
`;
      expect(
        transformFileLevelDirective(FILE, input),
      ).toEqual(`export async function getObject(...args) {
  return await ${rendererIpcCall("getObject")};
}
export const sum = async (...args) => {
  return await ${rendererIpcCall("sum")};
}
`);
    });

    test("transform file-level that has imported modules", () => {
      const input = `
"use node";
import { readFile } from "node:fs";
import { db } from "./db";

export async function getUser() {
  return db.user.findUnique();
}

export async function getFile(name) {
  return readFile(name, "utf-8");
}
`;
      expect(
        transformFileLevelDirective(FILE, input),
      ).toEqual(`export async function getUser(...args) {
  return await ${rendererIpcCall("getUser")};
}
export async function getFile(...args) {
  return await ${rendererIpcCall("getFile")};
}
`);
    });
  });

  describe("function-level directive", () => {
    test("identify function-level directive in exported function declaration", async () => {
      const input = `
export async function getUser(id) {
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(true);
    });

    test("identify function-level directive in exported arrow function", async () => {
      const input = `
export const getUser = async (id) => {
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(true);
    });

    test("identify function-level directive in non-exported function", async () => {
      const input = `
function getUser(id) {
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(true);
    });

    test("identify function-level directive in non-exported arrow function", async () => {
      const input = `
const getUser = async (id) => {
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(true);
    });

    test("must return false when no function has the directive", async () => {
      const input = `
export async function getUser(id) {
  return { id };
}

export const sum = async (a, b) => {
  return a + b;
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(false);
    });

    test("must return false when file has top-level directive", async () => {
      const input = `
"use node";

export async function getUser(id) {
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(false);
    });

    test("identify directive among mixed functions", async () => {
      const input = `
export async function noDirective() {
  return 1;
}

export async function withDirective() {
  "use node";
  return 2;
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(true);
    });

    test("must return false for directive not at function body top", async () => {
      const input = `
export async function getUser(id) {
  const x = 1;
  "use node";
  return { id };
}
`;

      const { program } = await parse("test.ts", input);
      expect(checkFunctionLevelDirective(program)).toEqual(false);
    });

    test("transform exported function with directive", () => {
      const input = `\
export async function getUser(id) {
  "use node";
  return { id };
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export async function getUser(...args) {
  return await ${rendererIpcCall("getUser")};
}
`);
    });

    test("transform exported arrow function with directive", () => {
      const input = `\
export const getUser = async (id) => {
  "use node";
  return { id };
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export const getUser = async (...args) => {
  return await ${rendererIpcCall("getUser")};
}
`);
    });

    test("transform only functions with directive, leave others intact", () => {
      const input = `\
import { db } from "./db";

export async function getUser(id) {
  "use node";
  return db.user.findUnique({ where: { id } });
}

export async function localHelper(x) {
  return x + 1;
}

export const fetchData = async (url) => {
  "use node";
  return fetch(url);
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\

export async function getUser(...args) {
  return await ${rendererIpcCall("getUser")};
}

export async function localHelper(x) {
  return x + 1;
}

export const fetchData = async (...args) => {
  return await ${rendererIpcCall("fetchData")};
}
`);
    });

    test("transform preserves imports and non-exported code", () => {
      const input = `\
import { readFile } from "node:fs";

const SECRET = "abc123";

export async function getFile(name) {
  "use node";
  return readFile(name, "utf-8");
}

function internalHelper() {
  return SECRET;
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\

const SECRET = "abc123";

export async function getFile(...args) {
  return await ${rendererIpcCall("getFile")};
}

function internalHelper() {
  return SECRET;
}
`);
    });

    test("throws on sync exported function with directive", () => {
      const input = `\
export function getData() {
  "use node";
  return { value: 42 };
}
`;
      expect(() => transformFunctionLevelDirective(FILE, input)).toThrow(
        /only allows async functions/,
      );
    });

    test("transforms non-exported functions with directive", () => {
      const input = `\
async function internalFn() {
  "use node";
  return 1;
}

export async function publicFn() {
  "use node";
  return 2;
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
async function internalFn(...args) {
  return await ${rendererIpcCall("internalFn")};
}

export async function publicFn(...args) {
  return await ${rendererIpcCall("publicFn")};
}
`);
    });

    test("throws on sync non-exported function with directive", () => {
      const input = `\
function internalFn() {
  "use node";
  return 1;
}
`;
      expect(() => transformFunctionLevelDirective(FILE, input)).toThrow(
        /only allows async functions/,
      );
    });

    test("no changes when no function has the directive", () => {
      const input = `\
export async function getUser(id) {
  return { id };
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export async function getUser(id) {
  return { id };
}
`);
    });
  });

  describe("unified transform()", () => {
    test("returns null for files without directives", () => {
      const input = `\
export async function getUser(id) {
  return { id };
}
`;
      expect(transform(input, FILE)).toBeNull();
    });

    test("transforms file-level directive", () => {
      const input = `
"use node";

export async function getUser() {
  return { id: 1 };
}

export const sum = async (a, b) => {
  return a + b;
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      expect(result).toContain(rendererIpcCall("getUser"));
      expect(result).toContain(rendererIpcCall("sum"));
    });

    test("transforms function-level directive for only marked functions", () => {
      const input = `\
export async function noDirective() {
  return 1;
}

export async function withDirective() {
  "use node";
  return 2;
}

export const arrowDirective = async (x) => {
  "use node";
  return x;
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      // noDirective should NOT be transformed
      expect(result).toContain("return 1;");
    });

    test("file-level throws on sync exported function", () => {
      const input = `
"use node";

export function syncFunc() {
  return 2;
}

export async function asyncFunc() {
  return 3;
}
`;
      expect(() => transform(input, FILE)).toThrow(
        /only allows async function exports/,
      );
    });

    test("file-level throws on re-exports", () => {
      const input = `
"use node";

const foo = 1;
export { foo };

export async function asyncFunc() {
  return 3;
}
`;
      expect(() => transform(input, FILE)).toThrow(/re-exports/);
    });

    test("file-level silently skips non-async variable export", () => {
      const input = `
"use node";

export const x = 5;

export async function asyncFunc() {
  return 3;
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      expect(result).not.toContain("export const x");
      expect(result).toContain(rendererIpcCall("asyncFunc"));
    });

    test("file-level silently strips type/interface exports", () => {
      const input = `
"use node";

export type Foo = { id: number };
export interface Bar { name: string }

export async function asyncFunc() {
  return 3;
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      expect(result).toContain(rendererIpcCall("asyncFunc"));
    });

    test("function-level throws on sync exported function with directive", () => {
      const input = `\
export function getData() {
  "use node";
  return { value: 42 };
}
`;
      expect(() => transform(input, FILE)).toThrow(
        /only allows async functions/,
      );
    });

    test("handler names match IPC channels in generated code", () => {
      const input = `
"use node";

export async function getUser() {
  return {};
}

export async function getFile() {
  return {};
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      // Channel strings must NOT appear in renderer output — they are hidden in the preload
      expect(result).toContain(rendererIpcCall("getUser"));
      expect(result).toContain(rendererIpcCall("getFile"));
    });
  });
});

describe("collectIdentifierPositions", () => {
  test("returns empty map for program with no identifiers", () => {
    const { program } = parseSync("test.ts", `"use strict";`);
    const result = collectIdentifierPositions(program);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  test("collects positions for identifiers in a simple program", () => {
    const code = "const foo = 1; const bar = foo + foo;";
    const { program } = parseSync("test.ts", code);
    const result = collectIdentifierPositions(program);
    // foo appears 3 times (declaration + 2 references)
    expect(result.get("foo")).toHaveLength(3);
    // bar appears 1 time (declaration)
    expect(result.get("bar")).toHaveLength(1);
  });
});

describe("partial-specifier import removal", () => {
  test("removes only the first specifier when it is exclusively inside a use-node body", () => {
    // readFile is used only in the "use node" body → should be removed
    // writeFile is used in normal code → should be kept
    const input = `\
import { readFile, writeFile } from "node:fs";

const dest = "out.txt";

export async function copyFile(src) {
  "use node";
  const data = readFile(src);
  writeFile(dest, data);
}

export function getDestination() {
  return writeFile;
}
`;
    const result = transformFunctionLevelDirective(FILE, input);
    expect(result).toContain("import {");
    expect(result).toContain("writeFile");
    expect(result).not.toContain("readFile");
  });

  test("removes only a non-first specifier when it is exclusively inside a use-node body", () => {
    // join is used only in the "use node" body → should be removed
    // resolve is used in normal code → should be kept
    const input = `\
import { resolve, join } from "node:path";

export async function buildPath(parts) {
  "use node";
  return join(...parts);
}

export function getRoot() {
  return resolve(".");
}
`;
    const result = transformFunctionLevelDirective(FILE, input);
    expect(result).toContain("import {");
    expect(result).toContain("resolve");
    expect(result).not.toContain("join");
  });

  test("removes the entire import when all specifiers are exclusively inside use-node bodies", () => {
    const input = `\
import { readFile, writeFile } from "node:fs";

export async function doWork() {
  "use node";
  readFile("a");
  writeFile("b", "c");
}
`;
    const result = transformFunctionLevelDirective(FILE, input);
    expect(result).not.toContain("import");
    expect(result).not.toContain("readFile");
    expect(result).not.toContain("writeFile");
  });
});

describe("generateChannelsModule", () => {
  test("empty registry produces an empty default export", () => {
    const result = generateChannelsModule(new Map());
    expect(result).toBe("export default [];");
  });

  test("generates a channel array entry for a single handler", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(JSON.stringify(channel));
  });

  test("full channel (including prefix) is in the array", () => {
    const prefix = "app:";
    const channel = channelName("/src/api.ts", "getData", prefix);
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(JSON.stringify(channel));
  });

  test("throws on duplicate channel strings", () => {
    const channel = channelName("/src/api.ts", "getUser");
    // Same channel appearing twice (simulates a hash collision)
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

describe("transformForMain", () => {
  test("returns null for files without directives", () => {
    const input = `\
export async function getUser(id) {
  return { id };
}
`;
    expect(transformForMain(FILE, input)).toBeNull();
  });

  test("file-level: keeps real implementation and appends ipcMain.handle calls", () => {
    const input = `\
"use node";
import { db } from "./db";

export async function getUser(id) {
  return db.user.findUnique({ where: { id } });
}
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    // Real implementation must be kept
    expect(result).toContain("db.user.findUnique");
    // ipcMain import injected
    expect(result).toContain(
      `import { ipcMain as __eaIpcMain } from "electron"`,
    );
    // handle call appended
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "getUser"))}, (_event, ...args) => getUser(...args))`,
    );
    // directive stripped
    expect(result).not.toContain('"use node"');
  });

  test("file-level: handles async arrow function exports", () => {
    const input = `\
"use node";

export const sum = async (a, b) => {
  return a + b;
};
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    expect(result).toContain("return a + b");
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "sum"))}, (_event, ...args) => sum(...args))`,
    );
  });

  test("function-level: appends handle call for exported function with directive", () => {
    const input = `\
export async function getUser(id) {
  "use node";
  return { id };
}
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    expect(result).toContain("return { id }");
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "getUser"))}, (_event, ...args) => getUser(...args))`,
    );
  });

  test("function-level: appends handle call for non-exported function with directive", () => {
    const input = `\
async function writeLog(msg) {
  "use node";
  return msg;
}
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    expect(result).toContain("return msg");
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "writeLog"))}, (_event, ...args) => writeLog(...args))`,
    );
  });

  test("function-level: only handles functions with directive, leaves others untouched", () => {
    const input = `\
export async function withDirective() {
  "use node";
  return 1;
}

export async function withoutDirective() {
  return 2;
}
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "withDirective"))}, (_event, ...args) => withDirective(...args))`,
    );
    expect(result).not.toContain("withoutDirective(...args)");
  });

  test("function-level: handles non-exported arrow function with directive", () => {
    const input = `\
const writeLog = async (msg) => {
  "use node";
  return msg;
};
`;
    const result = transformForMain(FILE, input);
    expect(result).not.toBeNull();
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "writeLog"))}, (_event, ...args) => writeLog(...args))`,
    );
  });

  test("channelPrefix flows through to handle calls", () => {
    const prefix = "app:";
    const input = `\
"use node";

export async function getUser() {
  return {};
}
`;
    const result = transformForMain(FILE, input, prefix);
    expect(result).not.toBeNull();
    expect(result).toContain(
      `__eaIpcMain.handle(${JSON.stringify(channelName(FILE, "getUser", prefix))}, (_event, ...args) => getUser(...args))`,
    );
  });
});

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
    // Loader module imports real file paths — channels are in the transformed files
    for (const filePath of registry.keys()) {
      expect(result).toContain(JSON.stringify(filePath));
    }
  });

  test("channelPrefix flows through scanForHandlers → generateChannelsModule (preload env)", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);
    const prefix = "my-app:";
    const registry = scanForHandlers(["src"], root, prefix);
    const result = generateChannelsModule(registry);
    // Every channel value in the output must start with the prefix
    for (const channels of registry.values()) {
      for (const channel of channels) {
        expect(channel.startsWith(prefix)).toBe(true);
        expect(result).toContain(JSON.stringify(channel));
      }
    }
  });
});

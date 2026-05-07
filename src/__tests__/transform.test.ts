import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { collectIdentifierPositions } from "../plugin/ast.ts";
import { makeActionId, makeDiscoveredAction } from "../plugin/channel.ts";
import {
  generateChannelsModule,
  generateHandlersMapModule,
} from "../plugin/codegen.ts";
import { scanForHandlers } from "../plugin/scanner.ts";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
  transform,
  transformFileLevelDirective,
  transformFunctionLevelDirective,
} from "../plugin/transform.ts";

// Use a fixed absolute file path so channel names are deterministic.
const FILE = "/file.ts";

/**
 * Build the expected `window.__ea[actionId](...args)` call for a handler.
 * The actionId is derived from the fixed FILE constant and the supplied actionId.
 */
const rendererIpcCall = (actionId: string) =>
  `window.__ea[${JSON.stringify(actionId)}](...args)`;

/**
 * Parse `code` (as FILE) and find the byte-offset for a handler named
 * `funcName`, then compute and return its actionId.
 *
 * This mirrors what the transform does at build time so tests can build
 * precise expected strings without hardcoding positions.
 */
function actionIdFor(code: string, funcName: string): string {
  const { program } = parseSync(FILE, code);
  for (const node of program.body) {
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;
      if (
        declaration?.type === "FunctionDeclaration" &&
        declaration.id?.name === funcName
      ) {
        return makeActionId(FILE, funcName, declaration.start);
      }
      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (decl.id.type === "Identifier" && decl.id.name === funcName) {
            return makeActionId(FILE, funcName, decl.start);
          }
        }
      }
    }
    if (node.type === "FunctionDeclaration" && node.id?.name === funcName) {
      return makeActionId(FILE, funcName, node.start);
    }
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.id.type === "Identifier" && decl.id.name === funcName) {
          return makeActionId(FILE, funcName, decl.start);
        }
      }
    }
  }
  throw new Error(`actionIdFor: function "${funcName}" not found in code`);
}

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
      const getObjectId = actionIdFor(input, "getObject");
      const sumId = actionIdFor(input, "sum");
      expect(
        transformFileLevelDirective(FILE, input),
      ).toEqual(`export async function getObject(...args) {
  return await ${rendererIpcCall(getObjectId)};
}
export const sum = async (...args) => {
  return await ${rendererIpcCall(sumId)};
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
      const getUserId = actionIdFor(input, "getUser");
      const getFileId = actionIdFor(input, "getFile");
      expect(
        transformFileLevelDirective(FILE, input),
      ).toEqual(`export async function getUser(...args) {
  return await ${rendererIpcCall(getUserId)};
}
export async function getFile(...args) {
  return await ${rendererIpcCall(getFileId)};
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
      const getUserId = actionIdFor(input, "getUser");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export async function getUser(...args) {
  return await ${rendererIpcCall(getUserId)};
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
      const getUserId = actionIdFor(input, "getUser");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export const getUser = async (...args) => {
  return await ${rendererIpcCall(getUserId)};
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
      const getUserId = actionIdFor(input, "getUser");
      const fetchDataId = actionIdFor(input, "fetchData");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\

export async function getUser(...args) {
  return await ${rendererIpcCall(getUserId)};
}

export async function localHelper(x) {
  return x + 1;
}

export const fetchData = async (...args) => {
  return await ${rendererIpcCall(fetchDataId)};
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
      const getFileId = actionIdFor(input, "getFile");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\

const SECRET = "abc123";

export async function getFile(...args) {
  return await ${rendererIpcCall(getFileId)};
}

function internalHelper() {
  return SECRET;
}
`);
    });

    test("transform sync exported function with directive", () => {
      const input = `\
export function getData() {
  "use node";
  return { value: 42 };
}
`;
      const getDataId = actionIdFor(input, "getData");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export async function getData(...args) {
  return await ${rendererIpcCall(getDataId)};
}
`);
    });

    test("transforms non-exported functions with directive", () => {
      const input = `\
function internalFn() {
  "use node";
  return 1;
}

export async function publicFn() {
  "use node";
  return 2;
}
`;
      const internalFnId = actionIdFor(input, "internalFn");
      const publicFnId = actionIdFor(input, "publicFn");
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
async function internalFn(...args) {
  return await ${rendererIpcCall(internalFnId)};
}

export async function publicFn(...args) {
  return await ${rendererIpcCall(publicFnId)};
}
`);
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
      expect(result).toContain(rendererIpcCall(actionIdFor(input, "getUser")));
      expect(result).toContain(rendererIpcCall(actionIdFor(input, "sum")));
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

    test("file-level throws on class export", () => {
      const input = `
"use node";

export class Foo {}
`;
      expect(() => transform(input, FILE)).toThrow(/class exports/);
    });

    test("file-level throws on non-async variable export", () => {
      const input = `
"use node";

export const x = 5;
`;
      expect(() => transform(input, FILE)).toThrow(
        /only allows async function exports/,
      );
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
      expect(result).toContain(
        rendererIpcCall(actionIdFor(input, "asyncFunc")),
      );
    });

    test("function-level extracts sync exported functions with directive", () => {
      const input = `\
export function getData() {
  "use node";
  return { value: 42 };
}
`;
      const result = transform(input, FILE);
      expect(result).not.toBeNull();
      expect(result).toContain(rendererIpcCall(actionIdFor(input, "getData")));
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
      expect(result).toContain(rendererIpcCall(actionIdFor(input, "getUser")));
      expect(result).toContain(rendererIpcCall(actionIdFor(input, "getFile")));
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
    expect(result).toBe("export default {};");
  });

  test("generates actionId → channel entries", () => {
    const action = makeDiscoveredAction("/src/api.ts", "getUser", 0);
    const registry = new Map([["/src/api.ts", [action]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(
      `${JSON.stringify(action.actionId)}: ${JSON.stringify(action.channel)}`,
    );
  });

  test("channel strings are present, action IDs (not bare function names) are the keys", () => {
    const action = makeDiscoveredAction("/src/api.ts", "getData", 0);
    const registry = new Map([["/src/api.ts", [action]]]);
    const result = generateChannelsModule(registry);
    // Channel is the value — used by ipcRenderer.invoke()
    expect(result).toContain(action.channel);
    // Action ID (not bare function name) is the key
    expect(result).toContain(`${JSON.stringify(action.actionId)}:`);
    // Action ID includes the function name as a readable prefix
    expect(action.actionId).toContain("getData");
    // Bare function name alone must NOT be the key
    expect(result).not.toContain('"getData":');
  });

  test("two handlers with the same name in different files get distinct actionId keys", () => {
    const action1 = makeDiscoveredAction("/src/users.ts", "getUser", 0);
    const action2 = makeDiscoveredAction("/src/posts.ts", "getUser", 0);
    const registry = new Map([
      ["/src/users.ts", [action1]],
      ["/src/posts.ts", [action2]],
    ]);
    const result = generateChannelsModule(registry);
    // Both action IDs must appear as distinct keys
    expect(result).toContain(JSON.stringify(action1.actionId));
    expect(result).toContain(JSON.stringify(action2.actionId));
    // They must be different keys
    expect(action1.actionId).not.toBe(action2.actionId);
  });

  test("two handlers with the same name in the same file at different positions get distinct actionId keys", () => {
    const action1 = makeDiscoveredAction("/src/api.ts", "handle", 10);
    const action2 = makeDiscoveredAction("/src/api.ts", "handle", 100);
    const registry = new Map([["/src/api.ts", [action1, action2]]]);
    const result = generateChannelsModule(registry);
    // Both action IDs must appear
    expect(result).toContain(JSON.stringify(action1.actionId));
    expect(result).toContain(JSON.stringify(action2.actionId));
    // They must be different
    expect(action1.actionId).not.toBe(action2.actionId);
    // Both contain the function name
    expect(action1.actionId).toContain("handle");
    expect(action2.actionId).toContain("handle");
  });
});

describe("generateHandlersMapModule", () => {
  test("empty registry produces an empty default export", () => {
    const result = generateHandlersMapModule(new Map(), (f) => f);
    expect(result).toBe("export default {};");
  });

  test("generates an import and a channel → fn entry for a single handler", () => {
    const action = makeDiscoveredAction("/src/api.ts", "getUser", 0);
    const registry = new Map([["/src/api.ts", [action]]]);
    const result = generateHandlersMapModule(registry, (f) => f);
    expect(result).toContain(`import * as _ea0 from "/src/api.ts"`);
    expect(result).toContain(
      `${JSON.stringify(action.channel)}: _ea0["getUser"]`,
    );
  });

  test("resolveImport is called per file — allows injecting re-export prefix", () => {
    const action = makeDiscoveredAction("/src/api.ts", "doWork", 0);
    const registry = new Map([["/src/api.ts", [action]]]);
    const result = generateHandlersMapModule(
      registry,
      (f) => `electron-actions:non-exported-actions:${f}`,
    );
    expect(result).toContain(
      `import * as _ea0 from "electron-actions:non-exported-actions:/src/api.ts"`,
    );
  });

  test("generates separate namespace imports for multiple files", () => {
    const a1 = makeDiscoveredAction("/src/users.ts", "getUser", 0);
    const a2 = makeDiscoveredAction("/src/posts.ts", "getPost", 0);
    const registry = new Map([
      ["/src/users.ts", [a1]],
      ["/src/posts.ts", [a2]],
    ]);
    const result = generateHandlersMapModule(registry, (f) => f);
    expect(result).toContain(`import * as _ea0 from "/src/users.ts"`);
    expect(result).toContain(`import * as _ea1 from "/src/posts.ts"`);
    expect(result).toContain(`${JSON.stringify(a1.channel)}: _ea0["getUser"]`);
    expect(result).toContain(`${JSON.stringify(a2.channel)}: _ea1["getPost"]`);
  });

  test("same function name in different files maps to distinct channels and fn bindings", () => {
    const a1 = makeDiscoveredAction("/src/users.ts", "getUser", 0);
    const a2 = makeDiscoveredAction("/src/posts.ts", "getUser", 0);
    const registry = new Map([
      ["/src/users.ts", [a1]],
      ["/src/posts.ts", [a2]],
    ]);
    const result = generateHandlersMapModule(registry, (f) => f);
    // Channels must be distinct
    expect(a1.channel).not.toBe(a2.channel);
    // Both channels appear in the output
    expect(result).toContain(JSON.stringify(a1.channel));
    expect(result).toContain(JSON.stringify(a2.channel));
    // Both resolve to the same export binding name (each from their own namespace)
    expect(result).toContain(`_ea0["getUser"]`);
    expect(result).toContain(`_ea1["getUser"]`);
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

  test("channelPrefix flows through scanForHandlers → generateHandlersMapModule (main env)", ({
    onTestFinished,
  }) => {
    const { root } = setup(onTestFinished);
    const prefix = "my-app:";
    const registry = scanForHandlers(["src"], root, prefix);
    const result = generateHandlersMapModule(registry, (f) => f);
    // Every channel key in the output must start with the prefix
    for (const actions of registry.values()) {
      for (const action of actions) {
        expect(action.channel.startsWith(prefix)).toBe(true);
        expect(result).toContain(JSON.stringify(action.channel));
      }
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
    for (const actions of registry.values()) {
      for (const action of actions) {
        expect(action.channel.startsWith(prefix)).toBe(true);
        expect(result).toContain(JSON.stringify(action.channel));
      }
    }
  });
});

describe("Option A: action ID collision-free naming", () => {
  test("actionId includes the function name as a readable prefix", () => {
    const action = makeDiscoveredAction("/src/api.ts", "getUser", 42);
    expect(action.actionId).toMatch(/^getUser__[a-f0-9]{8}_\d+$/);
  });

  test("same function name in different files produces different actionIds", () => {
    const a1 = makeDiscoveredAction("/src/users.ts", "getUser", 0);
    const a2 = makeDiscoveredAction("/src/posts.ts", "getUser", 0);
    expect(a1.actionId).not.toBe(a2.actionId);
  });

  test("same function name at different positions in same file produces different actionIds", () => {
    const a1 = makeDiscoveredAction("/src/api.ts", "handle", 10);
    const a2 = makeDiscoveredAction("/src/api.ts", "handle", 200);
    expect(a1.actionId).not.toBe(a2.actionId);
    expect(a1.channel).not.toBe(a2.channel);
  });

  test("same function name and position in same file always produces the same actionId (determinism)", () => {
    const a1 = makeDiscoveredAction("/src/api.ts", "getUser", 55);
    const a2 = makeDiscoveredAction("/src/api.ts", "getUser", 55);
    expect(a1.actionId).toBe(a2.actionId);
    expect(a1.channel).toBe(a2.channel);
  });

  test("channelPrefix does not affect actionId — renderer stubs work regardless of prefix", () => {
    const a1 = makeDiscoveredAction("/src/api.ts", "getUser", 55, "");
    const a2 = makeDiscoveredAction("/src/api.ts", "getUser", 55, "my-app:");
    // Same actionId — renderer stubs reference the same key regardless of prefix
    expect(a1.actionId).toBe(a2.actionId);
    // Channels differ because prefix is included in the channel
    expect(a1.channel).not.toBe(a2.channel);
  });

  test("renderer transform generates actionId-based window.__ea access (not bare funcName)", () => {
    const input = `\
export async function getUser(id) {
  "use node";
  return { id };
}
`;
    const result = transformFunctionLevelDirective(FILE, input);
    const expectedId = actionIdFor(input, "getUser");
    // actionId has the format funcName__hash_start
    expect(expectedId).toMatch(/^getUser__[a-f0-9]{8}_\d+$/);
    // The renderer stub uses the actionId, not the bare function name
    expect(result).toContain(`window.__ea[${JSON.stringify(expectedId)}]`);
    expect(result).not.toContain(`window.__ea["getUser"]`);
  });

  test("two files with the same function name produce non-colliding preload keys in generated channels module", ({
    onTestFinished,
  }) => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "ea-test-"));
    onTestFinished(() => rmSync(tmpDir, { recursive: true, force: true }));
    const srcDir = path.join(tmpDir, "src");
    mkdirSync(srcDir);
    // Two files both exporting a function named `getData`
    writeFileSync(
      path.join(srcDir, "alpha.ts"),
      `"use node";\nexport async function getData() { return "alpha"; }\n`,
    );
    writeFileSync(
      path.join(srcDir, "beta.ts"),
      `"use node";\nexport async function getData() { return "beta"; }\n`,
    );
    const registry = scanForHandlers(["src"], tmpDir);
    const channelsCode = generateChannelsModule(registry);

    // Collect all actionIds from the registry
    const allActionIds: string[] = [];
    for (const actions of registry.values()) {
      for (const action of actions) {
        allActionIds.push(action.actionId);
      }
    }

    // There must be exactly two distinct actionIds (no collision)
    expect(allActionIds).toHaveLength(2);
    expect(allActionIds[0]).not.toBe(allActionIds[1]);

    // Both actionIds must appear as keys in the generated channels module
    for (const id of allActionIds) {
      expect(channelsCode).toContain(JSON.stringify(id));
    }

    // The bare function name "getData" must NOT appear as a standalone key
    expect(channelsCode).not.toContain('"getData":');
  });
});

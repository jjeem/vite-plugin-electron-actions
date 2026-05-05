import { parse, parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { collectIdentifierPositions } from "../plugin/ast.ts";
import {
  generateChannelsModule,
  generateHandlersMapModule,
} from "../plugin/codegen.ts";
import {
  channelName,
  checkFileLevelDirective,
  checkFunctionLevelDirective,
  transform,
  transformFileLevelDirective,
  transformFunctionLevelDirective,
} from "../plugin/transform.ts";

// Use a fixed absolute file path so channel names are deterministic.
const FILE = "/file.ts";

const ch = (name: string) => channelName(FILE, name);
const rendererIpcCall = (name: string) =>
  `window.__ea[${JSON.stringify(name)}](...args)`;

describe("channelPrefix", () => {
  test("transform() with prefix includes prefixed channels in handlers (file-level)", () => {
    const input = `
"use node";

export async function getUser() {
  return {};
}

export async function deleteUser() {
  return {};
}
`;
    const withPrefix = transform(input, FILE, "my-app:");
    const withoutPrefix = transform(input, FILE);
    expect(withPrefix?.handlers).toEqual(
      withoutPrefix?.handlers.map((h) => `my-app:${h}`),
    );
  });

  test("transform() with prefix includes prefixed channels in handlers (function-level)", () => {
    const input = `
export async function getUser() {
  "use node";
  return {};
}

export async function notMarked() {
  return {};
}
`;
    const withPrefix = transform(input, FILE, "pfx:");
    const withoutPrefix = transform(input, FILE);
    expect(withPrefix?.handlers).toEqual(
      withoutPrefix?.handlers.map((h) => `pfx:${h}`),
    );
  });
});

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

    test("transform sync exported function with directive", () => {
      const input = `\
export function getData() {
  "use node";
  return { value: 42 };
}
`;
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
export async function getData(...args) {
  return await ${rendererIpcCall("getData")};
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
      expect(transformFunctionLevelDirective(FILE, input)).toEqual(`\
async function internalFn(...args) {
  return await ${rendererIpcCall("internalFn")};
}

export async function publicFn(...args) {
  return await ${rendererIpcCall("publicFn")};
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

    test("transforms file-level directive and extracts handlers", () => {
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
      expect(result?.handlers).toEqual([ch("getUser"), ch("sum")]);
      expect(result?.code).toContain(rendererIpcCall("getUser"));
      expect(result?.code).toContain(rendererIpcCall("sum"));
    });

    test("transforms function-level directive and extracts only marked handlers", () => {
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
      expect(result?.handlers).toEqual([
        ch("withDirective"),
        ch("arrowDirective"),
      ]);
      // noDirective should NOT be in handlers
      expect(result?.handlers).not.toContain(ch("noDirective"));
      // noDirective should remain untransformed in code
      expect(result?.code).toContain("return 1;");
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
      expect(result?.handlers).toEqual([ch("asyncFunc")]);
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
      expect(result?.handlers).toEqual([ch("getData")]);
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
      for (const channel of result?.handlers ?? []) {
        expect(result?.code).not.toContain(JSON.stringify(channel));
      }
      // Instead, named function calls appear
      expect(result?.code).toContain(rendererIpcCall("getUser"));
      expect(result?.code).toContain(rendererIpcCall("getFile"));
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

  test("generates fnName → channel entries", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    expect(result).toContain(`"getUser": "${channel}"`);
  });

  test("channel strings are present, function names are the keys (security boundary)", () => {
    const channel = channelName("/src/api.ts", "getData");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateChannelsModule(registry);
    // Channel hash is the value — never visible in the renderer
    expect(result).toContain(channel);
    // Function name is the key — what the renderer accesses via window.__ea
    expect(result).toContain(`"getData":`);
  });
});

describe("generateHandlersMapModule", () => {
  test("empty registry produces an empty default export", () => {
    const result = generateHandlersMapModule(new Map(), (f) => f);
    expect(result).toBe("export default {};");
  });

  test("generates an import and a channel → fn entry for a single handler", () => {
    const channel = channelName("/src/api.ts", "getUser");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateHandlersMapModule(registry, (f) => f);
    expect(result).toContain(`import * as _ea0 from "/src/api.ts"`);
    expect(result).toContain(`"${channel}": _ea0["getUser"]`);
  });

  test("resolveImport is called per file — allows injecting re-export prefix", () => {
    const channel = channelName("/src/api.ts", "doWork");
    const registry = new Map([["/src/api.ts", [channel]]]);
    const result = generateHandlersMapModule(
      registry,
      (f) => `electron-actions:non-exported-actions:${f}`,
    );
    expect(result).toContain(
      `import * as _ea0 from "electron-actions:non-exported-actions:/src/api.ts"`,
    );
  });

  test("generates separate namespace imports for multiple files", () => {
    const ch1 = channelName("/src/users.ts", "getUser");
    const ch2 = channelName("/src/posts.ts", "getPost");
    const registry = new Map([
      ["/src/users.ts", [ch1]],
      ["/src/posts.ts", [ch2]],
    ]);
    const result = generateHandlersMapModule(registry, (f) => f);
    expect(result).toContain(`import * as _ea0 from "/src/users.ts"`);
    expect(result).toContain(`import * as _ea1 from "/src/posts.ts"`);
    expect(result).toContain(`"${ch1}": _ea0["getUser"]`);
    expect(result).toContain(`"${ch2}": _ea1["getPost"]`);
  });
});

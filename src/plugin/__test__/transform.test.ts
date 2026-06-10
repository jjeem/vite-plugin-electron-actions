import { parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { channelName } from "../channel.ts";
import {
  transform,
  transformFileLevelDirective,
  transformForMain,
  transformFunctionLevelDirective,
} from "../transform.ts";

// Use a fixed absolute file path so channel names are deterministic.
const FILE = "/file.ts";

const rendererIpcCall = (name: string) =>
  `window.$$vitePluginElectronActions[${JSON.stringify(channelName(FILE, name))}](...args)`;

const mainIpcHandle = (name: string, prefix = "") =>
  `$vitePluginElectronActions_ipcMain.handle(${JSON.stringify(channelName(FILE, name, prefix))}, (event, ...args) => $vitePluginElectronActions_runAction(event, () => ${name}(...args)))`;

describe("transform", () => {
  describe("file top-level directive", () => {
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

    test("escapes channelPrefix in renderer stubs", () => {
      const prefix = 'app"\\dev:\n';
      const input = `
"use node";

export async function getObject() {
  return {};
}
`;
      const result = transformFileLevelDirective(FILE, input, prefix);
      const channel = channelName(FILE, "getObject", prefix);
      expect(result).toContain(
        `window.$$vitePluginElectronActions[${JSON.stringify(channel)}](...args)`,
      );
      expect(() => parseSync("renderer.ts", result)).not.toThrow();
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
      `import { ipcMain as $vitePluginElectronActions_ipcMain } from "electron"`,
    );
    expect(result).toContain(
      `import { $vitePluginElectronActions_runAction } from "vite-plugin-electron-actions/main"`,
    );
    // handle call appended
    expect(result).toContain(mainIpcHandle("getUser"));
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
    expect(result).toContain(mainIpcHandle("sum"));
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
    expect(result).toContain(mainIpcHandle("getUser"));
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
    expect(result).toContain(mainIpcHandle("writeLog"));
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
    expect(result).toContain(mainIpcHandle("withDirective"));
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
    expect(result).toContain(mainIpcHandle("writeLog"));
  });

  test("throws when user imports a binding named $vitePluginElectronActions_ipcMain", () => {
    const input = `\
"use node";

import { ipcMain as $vitePluginElectronActions_ipcMain } from "electron";

export async function getUser() {
  return {};
}
`;
    expect(() => transformForMain(FILE, input)).toThrow(
      /\$vitePluginElectronActions_ipcMain.*reserved/,
    );
  });

  test("throws when user has a variable named $vitePluginElectronActions_ipcMain", () => {
    const input = `\
"use node";

const $vitePluginElectronActions_ipcMain = "oops";

export async function getUser() {
  return {};
}
`;
    expect(() => transformForMain(FILE, input)).toThrow(
      /\$vitePluginElectronActions_ipcMain.*reserved/,
    );
  });

  test("throws regardless of which module the conflicting import comes from", () => {
    const input = `\
"use node";

import { something as $vitePluginElectronActions_ipcMain } from "some-other-lib";

export async function getUser() {
  return {};
}
`;
    expect(() => transformForMain(FILE, input)).toThrow(
      /\$vitePluginElectronActions_ipcMain.*reserved/,
    );
  });

  test("throws when user imports a binding named $vitePluginElectronActions_runAction", () => {
    const input = `\
"use node";

import { something as $vitePluginElectronActions_runAction } from "some-other-lib";

export async function getUser() {
  return {};
}
`;
    expect(() => transformForMain(FILE, input)).toThrow(
      /\$vitePluginElectronActions_runAction.*reserved/,
    );
  });

  test("does not throw when user imports ipcMain under a different alias", () => {
    const input = `\
"use node";

import { ipcMain as myIpcMain } from "electron";

export async function getUser() {
  return {};
}
`;
    expect(() => transformForMain(FILE, input)).not.toThrow();
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
    expect(result).toContain(mainIpcHandle("getUser", prefix));
  });

  test("escapes channelPrefix in handle calls", () => {
    const prefix = 'app"\\dev:\n';
    const input = `\
"use node";

export async function getUser() {
  return {};
}
`;
    const result = transformForMain(FILE, input, prefix);
    expect(result).not.toBeNull();
    expect(result).toContain(mainIpcHandle("getUser", prefix));
    expect(() => parseSync("main.ts", result ?? "")).not.toThrow();
  });
});

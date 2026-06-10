import { parse } from "oxc-parser";
import { describe, expect, test } from "vitest";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
} from "../directives.ts";

describe("directives", () => {
  describe("file-level directive", () => {
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
  });
});

import { parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { collectIdentifierPositions } from "../ast.ts";

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
    expect(result.get("foo")).toHaveLength(3);
    expect(result.get("bar")).toHaveLength(1);
  });
});

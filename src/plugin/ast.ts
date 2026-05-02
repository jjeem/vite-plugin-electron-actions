import { type Program, Visitor } from "oxc-parser";

// ── AST utilities ─────────────────────────────────────────────

/** Collect start positions of all Identifier nodes in a program via Visitor */
export function collectIdentifierPositions(
  program: Program,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  new Visitor({
    Identifier(node) {
      let arr = out.get(node.name);
      if (!arr) {
        arr = [];
        out.set(node.name, arr);
      }
      arr.push(node.start as number);
    },
  }).visit(program);
  return out;
}

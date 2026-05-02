import type {
  BlockStatement,
  Expression,
  FunctionBody,
  Program,
} from "oxc-parser";

// ── Directive detection ────────────────────────────────────────

export function checkFileLevelDirective(program: Program): boolean {
  const node = program.body?.[0];
  return node?.type === "ExpressionStatement" && node.directive === "use node";
}

export function hasUseNodeDirective(
  body: BlockStatement | FunctionBody | Expression | null | undefined,
): body is BlockStatement | FunctionBody {
  if (body?.type !== "BlockStatement") return false;
  const firstStmt = body.body?.[0];
  return (
    firstStmt?.type === "ExpressionStatement" &&
    firstStmt.directive === "use node"
  );
}

export function checkFunctionLevelDirective(program: Program): boolean {
  if (checkFileLevelDirective(program)) return false;

  for (const node of program.body) {
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;

      if (declaration?.type === "FunctionDeclaration") {
        if (hasUseNodeDirective(declaration.body)) return true;
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (decl.init?.type === "ArrowFunctionExpression") {
            if (hasUseNodeDirective(decl.init.body)) return true;
          }
        }
      }
    }

    if (node.type === "FunctionDeclaration") {
      if (hasUseNodeDirective(node.body)) return true;
    }

    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.init?.type === "ArrowFunctionExpression") {
          if (hasUseNodeDirective(decl.init.body)) return true;
        }
      }
    }
  }

  return false;
}

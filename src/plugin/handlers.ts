import type { Program } from "oxc-parser";
import { hasUseNodeDirective } from "./directives.js";

// ── Handler extraction ─────────────────────────────────────────

/**
 * Extract handler names to register in ipcMain.
 * - File-level: all exported async functions / async arrow fns
 * - Function-level: all functions (exported or not) with "use node" body
 */
export function extractHandlerNames(
  program: Program,
  fileLevel: boolean,
): string[] {
  const names: string[] = [];

  for (const node of program.body) {
    if (fileLevel) {
      if (node.type !== "ExportNamedDeclaration") continue;

      const { declaration } = node;

      if (declaration?.type === "FunctionDeclaration") {
        const id = declaration.id;
        const isNamedAsyncFunction =
          declaration.async && id?.type === "Identifier";

        if (isNamedAsyncFunction) {
          names.push(id.name);
        }
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          const id = decl.id;
          const init = decl.init;
          const isNamedAsyncArrowFunction =
            init?.type === "ArrowFunctionExpression" &&
            init.async &&
            id.type === "Identifier";

          if (isNamedAsyncArrowFunction) {
            names.push(id.name);
          }
        }
      }

      continue;
    }

    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;

    if (declaration?.type === "FunctionDeclaration") {
      const id = declaration.id;
      const isNamedFunction = id?.type === "Identifier";
      const hasFunctionLevelDirective = hasUseNodeDirective(declaration.body);

      if (isNamedFunction && hasFunctionLevelDirective) {
        names.push(id.name);
      }
    }

    if (declaration?.type === "VariableDeclaration") {
      for (const decl of declaration.declarations) {
        const id = decl.id;
        const init = decl.init;
        const isNamedArrowFunction =
          init?.type === "ArrowFunctionExpression" && id.type === "Identifier";

        if (!isNamedArrowFunction) continue;

        const hasFunctionLevelDirective = hasUseNodeDirective(init.body);

        if (hasFunctionLevelDirective) {
          names.push(id.name);
        }
      }
    }
  }

  return names;
}

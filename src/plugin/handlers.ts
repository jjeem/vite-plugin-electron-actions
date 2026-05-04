import type { Program } from "oxc-parser";
import {
  checkFunctionLevelDirective,
  hasUseNodeDirective,
} from "./directives.js";

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
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;

      if (declaration?.type === "FunctionDeclaration") {
        if (fileLevel) {
          if (declaration.async && declaration.id?.type === "Identifier") {
            names.push(declaration.id.name);
          }
        } else {
          if (
            declaration.id?.type === "Identifier" &&
            hasUseNodeDirective(declaration.body)
          ) {
            names.push(declaration.id.name);
          }
        }
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (
            decl.init?.type === "ArrowFunctionExpression" &&
            decl.id.type === "Identifier"
          ) {
            if (fileLevel) {
              if (decl.init.async) {
                names.push(decl.id.name);
              }
            } else {
              if (hasUseNodeDirective(decl.init.body)) {
                names.push(decl.id.name);
              }
            }
          }
        }
      }
    }

    // function-level only: non-exported functions with "use node"
    if (!fileLevel) {
      if (node.type === "FunctionDeclaration") {
        if (node.id?.type === "Identifier" && hasUseNodeDirective(node.body)) {
          names.push(node.id.name);
        }
      }

      if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations) {
          if (
            decl.init?.type === "ArrowFunctionExpression" &&
            decl.id.type === "Identifier" &&
            hasUseNodeDirective(decl.init.body)
          ) {
            names.push(decl.id.name);
          }
        }
      }
    }
  }

  return names;
}

/**
 * Returns names of non-exported functions/arrows that have a "use node"
 * directive. These need to be re-exported via electron-actions:non-exported-actions:
 * so that ipcMain.handle() can reference them via `import * as ns`.
 */
export function extractNonExportedHandlerNames(program: Program): string[] {
  if (!checkFunctionLevelDirective(program)) return [];

  const names: string[] = [];

  for (const node of program.body) {
    if (node.type === "FunctionDeclaration") {
      if (node.id?.type === "Identifier" && hasUseNodeDirective(node.body)) {
        names.push(node.id.name);
      }
    }

    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.init?.type === "ArrowFunctionExpression" &&
          decl.id.type === "Identifier" &&
          hasUseNodeDirective(decl.init.body)
        ) {
          names.push(decl.id.name);
        }
      }
    }
  }

  return names;
}

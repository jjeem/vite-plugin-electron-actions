import type { Program } from "oxc-parser";
import {
  checkFunctionLevelDirective,
  hasUseNodeDirective,
} from "./directives.js";

// ── Handler extraction ─────────────────────────────────────────

/** Raw metadata extracted for a single discovered handler. */
export interface HandlerInfo {
  /** The original JS function identifier. */
  name: string;
  /**
   * Byte offset of the function/variable-declarator node in the source.
   * Used as the position discriminator in the action ID so same-named
   * handlers in the same file produce distinct IDs.
   */
  start: number;
}

/**
 * Extract handler infos to register in ipcMain.
 * - File-level: all exported async functions / async arrow fns
 * - Function-level: all functions (exported or not) with "use node" body
 *
 * Returns name + byte-offset pairs rather than bare names so callers can
 * derive collision-free action IDs.
 */
export function extractHandlerInfos(
  program: Program,
  fileLevel: boolean,
): HandlerInfo[] {
  const infos: HandlerInfo[] = [];

  for (const node of program.body) {
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;

      if (declaration?.type === "FunctionDeclaration") {
        if (fileLevel) {
          if (declaration.async && declaration.id?.type === "Identifier") {
            infos.push({ name: declaration.id.name, start: declaration.start });
          }
        } else {
          if (
            declaration.id?.type === "Identifier" &&
            hasUseNodeDirective(declaration.body)
          ) {
            infos.push({ name: declaration.id.name, start: declaration.start });
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
                infos.push({ name: decl.id.name, start: decl.start });
              }
            } else {
              if (hasUseNodeDirective(decl.init.body)) {
                infos.push({ name: decl.id.name, start: decl.start });
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
          infos.push({ name: node.id.name, start: node.start });
        }
      }

      if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations) {
          if (
            decl.init?.type === "ArrowFunctionExpression" &&
            decl.id.type === "Identifier" &&
            hasUseNodeDirective(decl.init.body)
          ) {
            infos.push({ name: decl.id.name, start: decl.start });
          }
        }
      }
    }
  }

  return infos;
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

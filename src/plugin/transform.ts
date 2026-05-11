import MagicString from "magic-string";
import {
  type ImportDefaultSpecifier,
  type ImportNamespaceSpecifier,
  type ImportSpecifier,
  parseSync,
} from "oxc-parser";
import { collectIdentifierPositions } from "./ast.js";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
  hasUseNodeDirective,
} from "./directives.js";
import { ipcInvokerArrow, ipcInvokerFn } from "./ipcInvoker.js";

// ── Re-exports for external consumers ─────────────────────────

export {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
} from "./directives.js";
export { extractNonExportedHandlerNames } from "./handlers.js";
export { scanForHandlers } from "./scanner.js";

// ── Renderer transforms ────────────────────────────────────────

export function transformFileLevelDirective(
  fileName: string,
  code: string,
): string {
  const { program } = parseSync(fileName, code);
  let newCode = "";

  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;

    const { declaration } = node;

    // Re-exports: `export { foo }` or `export { foo } from "..."` — not allowed
    if (!declaration && node.specifiers && node.specifiers.length > 0) {
      throw new Error(
        `[electron-actions] File-level "use node" does not allow re-exports (\`export { ... }\`). Found in ${fileName}.`,
      );
    }

    if (declaration?.type === "FunctionDeclaration") {
      if (!declaration.async) {
        throw new Error(
          `[electron-actions] File-level "use node" only allows async function exports. Found sync function \`${declaration.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
        );
      }
      if (!declaration.id || declaration.id.type !== "Identifier") {
        throw new Error("Exported async function must have a name");
      }
      const name = declaration.id.name;
      newCode = newCode.concat(`export ${ipcInvokerFn(name)}\n`);
    }

    if (declaration?.type === "VariableDeclaration") {
      for (const decl of declaration.declarations) {
        const init = decl.init;
        const isAsyncArrow =
          init?.type === "ArrowFunctionExpression" && init.async;
        const isAsyncFnExpr = init?.type === "FunctionExpression" && init.async;

        if (isAsyncArrow || isAsyncFnExpr) {
          if (decl.id.type === "Identifier") {
            const name = decl.id.name;
            newCode = newCode.concat(`export ${ipcInvokerArrow(name)}\n`);
          }
        } else {
          // Non-async variable export (e.g. `export const x = 5`) — not allowed
          throw new Error(
            `[electron-actions] File-level "use node" only allows async function exports. Found non-async export \`${decl.id.type === "Identifier" ? decl.id.name : "(unknown)"}\` in ${fileName}.`,
          );
        }
      }
    }
  }

  return newCode;
}

export function transformFunctionLevelDirective(
  fileName: string,
  code: string,
): string {
  const { program } = parseSync(fileName, code);
  const s = new MagicString(code);

  // ── Collect "use node" body spans + replace with IPC stubs ───
  // Done in a single pass: record spans for import-removal, and
  // overwrite each "use node" function with its IPC invoker stub.
  const useNodeBodySpans: Array<{ start: number; end: number }> = [];

  for (const node of program.body) {
    // ── exported function declaration ──────────────────────────
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;

      if (declaration?.type === "FunctionDeclaration") {
        if (hasUseNodeDirective(declaration.body)) {
          if (!declaration.async) {
            throw new Error(
              `[electron-actions] Function-level "use node" only allows async functions. Found sync function \`${declaration.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
            );
          }
          if (!declaration.id || declaration.id.type !== "Identifier") {
            throw new Error(
              'Exported function with "use node" must have a name',
            );
          }
          const name = declaration.id.name;
          useNodeBodySpans.push({
            start: declaration.body.start,
            end: declaration.body.end,
          });
          s.overwrite(node.start, node.end, `export ${ipcInvokerFn(name)}`);
        }
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (
            decl.init?.type === "ArrowFunctionExpression" &&
            decl.id.type === "Identifier" &&
            hasUseNodeDirective(decl.init.body)
          ) {
            if (!decl.init.async) {
              throw new Error(
                `[electron-actions] Function-level "use node" only allows async functions. Found sync arrow function \`${decl.id.name}\` in ${fileName}.`,
              );
            }
            const name = decl.id.name;
            useNodeBodySpans.push({
              start: decl.init.body.start,
              end: decl.init.body.end,
            });
            s.overwrite(
              node.start,
              node.end,
              `export ${ipcInvokerArrow(name)}`,
            );
          }
        }
      }
    }

    // ── non-exported function declaration ──────────────────────
    if (node.type === "FunctionDeclaration") {
      if (hasUseNodeDirective(node.body)) {
        if (!node.async) {
          throw new Error(
            `[electron-actions] Function-level "use node" only allows async functions. Found sync function \`${node.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
          );
        }
        if (!node.id || node.id.type !== "Identifier") {
          throw new Error('Function with "use node" must have a name');
        }
        const name = node.id.name;
        useNodeBodySpans.push({ start: node.body.start, end: node.body.end });
        s.overwrite(node.start, node.end, ipcInvokerFn(name));
      }
    }

    // ── non-exported variable arrow function ───────────────────
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.init?.type === "ArrowFunctionExpression" &&
          decl.id.type === "Identifier" &&
          hasUseNodeDirective(decl.init.body)
        ) {
          if (!decl.init.async) {
            throw new Error(
              `[electron-actions] Function-level "use node" only allows async functions. Found sync arrow function \`${decl.id.name}\` in ${fileName}.`,
            );
          }
          const name = decl.id.name;
          useNodeBodySpans.push({
            start: decl.init.body.start,
            end: decl.init.body.end,
          });
          s.overwrite(node.start, node.end, ipcInvokerArrow(name));
        }
      }
    }
  }

  // ── Remove imports used only inside "use node" bodies ─────────
  if (useNodeBodySpans.length > 0) {
    // Collect all identifier positions across the whole program
    const identPositions = collectIdentifierPositions(program);

    function isInsideUseNodeBody(pos: number): boolean {
      for (const span of useNodeBodySpans) {
        if (pos >= span.start && pos <= span.end) return true;
      }
      return false;
    }

    for (const node of program.body) {
      if (node.type !== "ImportDeclaration") continue;
      // Skip type-only imports entirely — they have no runtime presence
      if (node.importKind === "type") continue;

      const specifiersToRemove: Array<
        ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier
      > = [];

      for (const specifier of node.specifiers ?? []) {
        // Skip type-only specifiers (only ImportSpecifier has importKind)
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type"
        )
          continue;

        const localName = specifier.local.name;
        const positions = identPositions.get(localName) ?? [];

        // Check if there's any reference to this name OUTSIDE "use node" bodies
        // (exclude the specifier's own position)
        const usedOutside = positions.some(
          (pos) => pos !== specifier.local.start && !isInsideUseNodeBody(pos),
        );

        if (!usedOutside) {
          specifiersToRemove.push(specifier);
        }
      }

      const allSpecifiers = node.specifiers ?? [];
      if (specifiersToRemove.length === 0) continue;

      if (specifiersToRemove.length === allSpecifiers.length) {
        // Remove the entire import statement (including trailing newline if any)
        const end =
          node.end < code.length && code[node.end] === "\n"
            ? node.end + 1
            : node.end;
        s.remove(node.start, end);
      } else {
        // Remove individual specifiers from the import
        for (const spec of specifiersToRemove) {
          // Find the extent of this specifier including surrounding comma/spaces
          const allIdx = allSpecifiers.indexOf(spec);
          if (allIdx === 0) {
            // First specifier — remove up to (and including) the comma after it
            const nextSpec = allSpecifiers[allIdx + 1];
            if (nextSpec) s.remove(spec.start, nextSpec.start);
          } else {
            // Non-first specifier — remove from previous specifier end to this end
            const prevSpec = allSpecifiers[allIdx - 1];
            if (prevSpec) s.remove(prevSpec.end, spec.end);
          }
        }
      }
    }
  }

  return s.toString();
}

// ── Unified transform entry point ──────────────────────────────

/**
 * Main transform function called by the Vite plugin.
 *
 * Returns the transformed renderer stub code, or `null` if the file
 * contains no `"use node"` directives.
 */
export function transform(code: string, fileName: string): string | null {
  const { program } = parseSync(fileName, code);

  const isFileLevel = checkFileLevelDirective(program);
  const isFunctionLevel = checkFunctionLevelDirective(program);

  if (!isFileLevel && !isFunctionLevel) return null;

  if (isFileLevel) {
    return transformFileLevelDirective(fileName, code);
  }

  return transformFunctionLevelDirective(fileName, code);
}

import MagicString from "magic-string";
import {
  type ImportDefaultSpecifier,
  type ImportNamespaceSpecifier,
  type ImportSpecifier,
  type Program,
  parseSync,
} from "oxc-parser";
import { collectIdentifierPositions } from "./ast.js";
import { channelName } from "./channel.js";
import { ipcInvokerArrow, ipcInvokerFn } from "./codegen.ts";
import {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
  hasUseNodeDirective,
} from "./directives.js";

// ── Re-exports for external consumers ─────────────────────────

export {
  checkFileLevelDirective,
  checkFunctionLevelDirective,
} from "./directives.js";
export { scanForHandlers } from "./scanner.js";

// ── Renderer transforms ────────────────────────────────────────

function validateFileLevelExports(fileName: string, program: Program): void {
  for (const node of program.body) {
    if (node.type === "ExportDefaultDeclaration") {
      throw new Error(
        `[vite-plugin-electron-actions] File-level "use node" only allows named async function exports, type aliases, and interfaces. Found default export in ${fileName}.`,
      );
    }

    if (node.type === "ExportAllDeclaration") {
      throw new Error(
        `[vite-plugin-electron-actions] File-level "use node" does not allow re-exports. Found in ${fileName}.`,
      );
    }

    if (node.type !== "ExportNamedDeclaration") continue;

    const { declaration } = node;
    if (!declaration) {
      throw new Error(
        `[vite-plugin-electron-actions] File-level "use node" does not allow re-exports (\`export { ... }\`). Found in ${fileName}.`,
      );
    }

    if (
      declaration.type === "TSTypeAliasDeclaration" ||
      declaration.type === "TSInterfaceDeclaration"
    ) {
      continue;
    }

    if (declaration.type === "FunctionDeclaration") {
      if (!declaration.async) {
        throw new Error(
          `[vite-plugin-electron-actions] File-level "use node" only allows async function exports. Found sync function \`${declaration.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
        );
      }
      continue;
    }

    if (declaration.type === "VariableDeclaration") {
      for (const decl of declaration.declarations) {
        const init = decl.init;
        const isAsyncArrow =
          init?.type === "ArrowFunctionExpression" && init.async;
        const isAsyncFnExpr = init?.type === "FunctionExpression" && init.async;

        if (
          (!isAsyncArrow && !isAsyncFnExpr) ||
          decl.id.type !== "Identifier"
        ) {
          throw new Error(
            `[vite-plugin-electron-actions] File-level "use node" only allows async function exports. Found non-action export \`${decl.id.type === "Identifier" ? decl.id.name : "(unknown)"}\` in ${fileName}.`,
          );
        }
      }
      continue;
    }

    throw new Error(
      `[vite-plugin-electron-actions] File-level "use node" only allows async function exports, type aliases, and interfaces. Found unsupported export in ${fileName}.`,
    );
  }
}

export function transformFileLevelDirective(
  fileName: string,
  code: string,
  channelPrefix = "",
): string {
  const { program } = parseSync(fileName, code);
  validateFileLevelExports(fileName, program);
  let newCode = "";

  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;

    const { declaration } = node;

    if (declaration?.type === "FunctionDeclaration") {
      if (!declaration.id || declaration.id.type !== "Identifier") {
        throw new Error("Exported async function must have a name");
      }
      const name = declaration.id.name;
      const key = channelName(fileName, name, channelPrefix);
      newCode = newCode.concat(`export ${ipcInvokerFn(name, key)}\n`);
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
            const key = channelName(fileName, name, channelPrefix);
            newCode = newCode.concat(`export ${ipcInvokerArrow(name, key)}\n`);
          }
        }
      }
    }
  }

  return newCode;
}

export function transformFunctionLevelDirective(
  fileName: string,
  code: string,
  channelPrefix = "",
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
              `[vite-plugin-electron-actions] Function-level "use node" only allows async functions. Found sync function \`${declaration.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
            );
          }
          if (!declaration.id || declaration.id.type !== "Identifier") {
            throw new Error(
              'Exported function with "use node" must have a name',
            );
          }
          const name = declaration.id.name;
          const key = channelName(fileName, name, channelPrefix);
          useNodeBodySpans.push({
            start: declaration.body.start,
            end: declaration.body.end,
          });
          s.overwrite(
            node.start,
            node.end,
            `export ${ipcInvokerFn(name, key)}`,
          );
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
                `[vite-plugin-electron-actions] Function-level "use node" only allows async functions. Found sync arrow function \`${decl.id.name}\` in ${fileName}.`,
              );
            }
            const name = decl.id.name;
            const key = channelName(fileName, name, channelPrefix);
            useNodeBodySpans.push({
              start: decl.init.body.start,
              end: decl.init.body.end,
            });
            s.overwrite(
              node.start,
              node.end,
              `export ${ipcInvokerArrow(name, key)}`,
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
            `[vite-plugin-electron-actions] Function-level "use node" only allows async functions. Found sync function \`${node.id?.name ?? "(anonymous)"}\` in ${fileName}.`,
          );
        }
        if (!node.id || node.id.type !== "Identifier") {
          throw new Error('Function with "use node" must have a name');
        }
        const name = node.id.name;
        const key = channelName(fileName, name, channelPrefix);
        useNodeBodySpans.push({ start: node.body.start, end: node.body.end });
        s.overwrite(node.start, node.end, ipcInvokerFn(name, key));
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
              `[vite-plugin-electron-actions] Function-level "use node" only allows async functions. Found sync arrow function \`${decl.id.name}\` in ${fileName}.`,
            );
          }
          const name = decl.id.name;
          const key = channelName(fileName, name, channelPrefix);
          useNodeBodySpans.push({
            start: decl.init.body.start,
            end: decl.init.body.end,
          });
          s.overwrite(node.start, node.end, ipcInvokerArrow(name, key));
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

// ── Reserved identifier guard ──────────────────────────────────

const RESERVED_IPC_MAIN = "$$vitePluginElectronActions_ipcMain";
const RESERVED_RUN_ACTION = "$$vitePluginElectronActions_runAction";
const RESERVED_IDENTIFIERS = [RESERVED_IPC_MAIN, RESERVED_RUN_ACTION];

/**
 * Throws if the user's source file already declares a binding whose local
 * name collides with the identifier the plugin will inject. Checks both
 * import specifiers and top-level variable declarations.
 */
function checkReservedIdentifierUsage(
  fileName: string,
  program: ReturnType<typeof parseSync>["program"],
): void {
  for (const node of program.body) {
    if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers ?? []) {
        if (RESERVED_IDENTIFIERS.includes(spec.local.name)) {
          throw new Error(
            `[vite-plugin-electron-actions] The identifier "${spec.local.name}" is reserved by vite-plugin-electron-actions. Please rename your import in ${fileName}.`,
          );
        }
      }
    }

    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.id.type === "Identifier" &&
          RESERVED_IDENTIFIERS.includes(decl.id.name)
        ) {
          throw new Error(
            `[vite-plugin-electron-actions] The identifier "${decl.id.name}" is reserved by vite-plugin-electron-actions. Please rename your variable in ${fileName}.`,
          );
        }
      }
    }
  }
}

// ── Main process transform ─────────────────────────────────────

/**
 * Transform a `"use node"` file for the Electron main process build.
 *
 * Instead of replacing functions with IPC stubs (as the renderer transform
 * does), this keeps the real implementations and appends an
 * `ipcMain.handle()` call for each handler directly into the file.
 *
 * This means every `"use node"` file is its own self-registering module —
 * side effects run exactly once regardless of how many times the file is
 * imported, because the bundler deduplicates by module ID.
 *
 * The `vite-plugin-electron-actions:load-handlers` virtual module imports
 * all handler files as side effects so that `setupMain()` triggers
 * registration as part of the static module graph.
 *
 * Returns `null` if the file contains no `"use node"` directives.
 */
export function transformForMain(
  fileName: string,
  code: string,
  channelPrefix = "",
): string | null {
  const { program } = parseSync(fileName, code);

  const isFileLevel = checkFileLevelDirective(program);
  const isFunctionLevel = checkFunctionLevelDirective(program);

  if (!isFileLevel && !isFunctionLevel) return null;

  const s = new MagicString(code);
  const handlers: Array<{ name: string; channel: string }> = [];

  if (isFileLevel) {
    validateFileLevelExports(fileName, program);

    // Strip the "use node" directive string from the output
    const directiveNode = program.body[0];
    if (directiveNode) {
      const end =
        directiveNode.end < code.length && code[directiveNode.end] === "\n"
          ? directiveNode.end + 1
          : directiveNode.end;
      s.remove(directiveNode.start, end);
    }

    for (const node of program.body) {
      if (node.type !== "ExportNamedDeclaration") continue;
      const { declaration } = node;

      if (
        declaration?.type === "FunctionDeclaration" &&
        declaration.async &&
        declaration.id?.type === "Identifier"
      ) {
        const name = declaration.id.name;
        handlers.push({
          name,
          channel: channelName(fileName, name, channelPrefix),
        });
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          const init = decl.init;
          const isAsyncArrow =
            init?.type === "ArrowFunctionExpression" && init.async;
          const isAsyncFnExpr =
            init?.type === "FunctionExpression" && init.async;
          if (
            (isAsyncArrow || isAsyncFnExpr) &&
            decl.id.type === "Identifier"
          ) {
            const name = decl.id.name;
            handlers.push({
              name,
              channel: channelName(fileName, name, channelPrefix),
            });
          }
        }
      }
    }
  } else {
    // Function-level: collect every function with a "use node" body,
    // exported or not.
    for (const node of program.body) {
      if (node.type === "ExportNamedDeclaration") {
        const { declaration } = node;

        if (
          declaration?.type === "FunctionDeclaration" &&
          declaration.id?.type === "Identifier" &&
          hasUseNodeDirective(declaration.body)
        ) {
          const name = declaration.id.name;
          handlers.push({
            name,
            channel: channelName(fileName, name, channelPrefix),
          });
        }

        if (declaration?.type === "VariableDeclaration") {
          for (const decl of declaration.declarations) {
            if (
              decl.init?.type === "ArrowFunctionExpression" &&
              decl.id.type === "Identifier" &&
              hasUseNodeDirective(decl.init.body)
            ) {
              const name = decl.id.name;
              handlers.push({
                name,
                channel: channelName(fileName, name, channelPrefix),
              });
            }
          }
        }
      }

      if (
        node.type === "FunctionDeclaration" &&
        node.id?.type === "Identifier" &&
        hasUseNodeDirective(node.body)
      ) {
        const name = node.id.name;
        handlers.push({
          name,
          channel: channelName(fileName, name, channelPrefix),
        });
      }

      if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations) {
          if (
            decl.init?.type === "ArrowFunctionExpression" &&
            decl.id.type === "Identifier" &&
            hasUseNodeDirective(decl.init.body)
          ) {
            const name = decl.id.name;
            handlers.push({
              name,
              channel: channelName(fileName, name, channelPrefix),
            });
          }
        }
      }
    }
  }

  if (handlers.length === 0) return null;

  checkReservedIdentifierUsage(fileName, program);

  s.prepend(
    `import { ipcMain as ${RESERVED_IPC_MAIN} } from "electron"\nimport { ${RESERVED_RUN_ACTION} } from "vite-plugin-electron-actions/main"\n`,
  );
  for (const { name, channel } of handlers) {
    s.append(
      `\n${RESERVED_IPC_MAIN}.handle(${JSON.stringify(channel)}, (event, ...args) => ${RESERVED_RUN_ACTION}(event, () => ${name}(...args)))`,
    );
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
export function transform(
  code: string,
  fileName: string,
  channelPrefix = "",
): string | null {
  const { program } = parseSync(fileName, code);

  const isFileLevel = checkFileLevelDirective(program);
  const isFunctionLevel = checkFunctionLevelDirective(program);

  if (!isFileLevel && !isFunctionLevel) return null;

  if (isFileLevel) {
    return transformFileLevelDirective(fileName, code, channelPrefix);
  }

  return transformFunctionLevelDirective(fileName, code, channelPrefix);
}

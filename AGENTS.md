# AGENTS.md - Repository Guide

## Build Commands

```bash

pnpm exec tsc --noEmit    # Check for TypeScript errors (run after any source changes)
pnpm run dev          # Build with watch mode (tsdown)
pnpm run build        # Build library
pnpm run check        # Biome check
pnpm run check:fix # Biome check --write
pnpm run test         # Run tests (vitest)

```

## Code Style Guidelines

### Formatting (Biome)

Use `pnpm run check` script

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Double quotes for JavaScript/TypeScript
- **Line endings**: LF
- **Max line length**: 80 (default)
- **Semicolons**: ASI (Automatic Semicolon Insertion)
- **Trailing commas**: ES5 compatible

### TypeScript Configuration

- **Target**: ES2022
- **Module**: NodeNext
- **Strict mode**: Enabled
- **Declaration files**: Required (`.d.ts`)
- **Isolated declarations**: Enabled
- **Verbatim module syntax**: Enabled
- **No unchecked side effect imports**: Enabled
- **Exact optional property types**: Enabled
- **No unchecked indexed access**: Enabled

### Import Style

```typescript
// Use double quotes
import { ipcMain } from "electron";
import path from "node:path";

// Organize imports (Biome auto-fixes this)
// External imports first, then internal
```

### Naming Conventions

- **Classes**: PascalCase (e.g., `Router`, `Client`)
- **Types/Interfaces**: PascalCase (e.g., `ElectronActionsOptions`)
- **Functions**: camelCase (e.g., `electronActions`, `transformFileLevelDirective`)
- **Variables**: camelCase (e.g., `handlers`, `root`)
- **Constants**: camelCase or UPPER_SNAKE_CASE for true constants

### Linting Rules (Biome)

Key rules enforced:

- `noUnusedVariables`: error
- `noParameterAssign`: error (don't reassign parameters)
- `useAsConstAssertion`: error (use `as const` where appropriate)
- `useDefaultParameterLast`: error
- `useEnumInitializers`: error
- `useSelfClosingElements`: error (JSX/TSX)
- `noUnusedTemplateLiteral`: error (avoid unnecessary template literals)
- `noInferrableTypes`: error (don't annotate obvious types)
- `noUselessElse`: error
- `noExplicitAny`: on

## Project Structure

```
electron-actions/
├── src/
│   ├── index.ts              # Vite plugin entry: electronActions({ env }), three env-specific branches
│   ├── types.ts              # ElectronActionsOptions type (env field required)
│   ├── virtual.d.ts          # Ambient type declarations for electron-actions:channels and electron-actions:handlers-map
│   ├── plugin/
│   │   ├── ast.ts            # AST utilities (collectIdentifierPositions)
│   │   ├── channel.ts        # channelName() — derives IPC channel from file path, function name, and optional prefix
│   │   ├── codegen.ts        # generateChannelsModule(), generateHandlersMapModule() — data-only virtual module codegen
│   │   ├── directives.ts     # checkFileLevelDirective(), checkFunctionLevelDirective()
│   │   ├── handlers.ts       # extractHandlerNames(), extractNonExportedHandlerNames()
│   │   ├── ipcInvoker.ts     # ipcInvokerFn(), ipcInvokerArrow() — renderer stub generators
│   │   ├── scanner.ts        # scanForHandlers() — filesystem scan for "use node" files
│   │   └── transform.ts      # transform(), transformFileLevelDirective(), transformFunctionLevelDirective()
│   ├── main/
│   │   └── index.ts          # setupMain() — real impl; imports electron-actions:handlers-map
│   └── preload/
│       └── index.ts          # setupPreload() + Window.__ea global type; imports electron-actions:channels
├── src/__tests__/
│   └── transform.test.ts     # vitest tests covering transform, directives, and codegen
├── dist/                     # Built output (gitignored)
│   ├── index.mjs             # ESM build (main entry)
│   ├── index.cjs             # CJS build (main entry)
│   ├── index.d.mts           # ESM type declarations
│   ├── index.d.cts           # CJS type declarations
│   ├── main/
│   │   └── index.mjs         # ESM build (main entry — setupMain)
│   └── preload/
│       └── index.mjs         # ESM build (preload entry — setupPreload)
```

## How the Plugin Works

### Directives

Two modes of marking server-side (Node.js) code:

**File-level**: `"use node"` at the top of the file. All exported async functions become IPC calls. Only async function/arrow exports are allowed — sync exports, re-exports (`export { foo }`), classes, and non-async variables throw an error. Type/interface exports are silently stripped.

```ts
"use node"

export async function getUser(id: string) {
  return db.user.findUnique({ where: { id } })
}
```

**Function-level**: `"use node"` inside individual function bodies. Only those functions become stubs (ipcInvokers); everything else is preserved. Works on exported AND non-exported functions. Imports used exclusively inside `"use node"` bodies are automatically removed from the renderer output.

```ts
const writeToFile = async () => {
  "use node"
  await fs.writeFile("test.txt", "Hello, world!")
}
```

### Virtual Module: `electron-actions:handlers-map`

Intercepted by the `env:"main"` plugin. Generates a data-only default export of
`{ [channelString]: handlerFn }` by importing all handler files. `setupMain()` in
`src/main/index.ts` iterates this map and calls `ipcMain.handle()` for each entry:

```ts
import { setupMain } from "vite-plugin-electron-actions/main";
setupMain();
```

The plugin scans `scanDirs` (default `["src"]`) at build time to discover all handlers.
Non-exported `"use node"` functions are automatically re-exported via the internal
`electron-actions:non-exported-actions:` prefix so `ipcMain.handle()` can reference them.

### Virtual Module: `electron-actions:channels`

Intercepted by the `env:"preload"` plugin. Generates a data-only default export of
`{ [fnName]: channelString }`. `setupPreload()` in `src/preload/index.ts` iterates this
map and wires up `contextBridge.exposeInMainWorld("__ea", api)`:

```ts
import { setupPreload } from "vite-plugin-electron-actions/preload";
setupPreload();
```

The plugin scans `scanDirs` (default `["src"]`) at build time to discover all handlers.
Non-exported `"use node"` functions are automatically re-exported via the internal
`electron-actions:non-exported-actions:` prefix so `ipcMain.handle()` can reference them.

### Virtual Module: `vite-plugin-electron-actions/preload`

Intercepted by the `env:"preload"` plugin. The generated `setupPreload()` body imports
`contextBridge` and `ipcRenderer` from `"electron"` and wires up every discovered handler
as a named function on `window.__ea`. Call it once in your preload script:

```ts
import { setupPreload } from "vite-plugin-electron-actions/preload";
setupPreload();
```

### Renderer Bridge

`setupPreload()` exposes `window.__ea` via `contextBridge.exposeInMainWorld` as an object
of individually named functions, each locked to a single pre-determined IPC channel. The
renderer cannot invoke arbitrary channels — it can only call the specific named functions
declared with `"use node"`.

### Plugin Registration

The plugin must be registered in **three places** in `vite.config.ts` — once for the
renderer build, once for the main process build, and once for the preload build (all run
in isolated Vite instances):

```ts
import { electronActions } from "vite-plugin-electron-actions";

export default defineConfig({
  plugins: [electronActions({ env: "renderer" })],
  // ...
  electron([{
    entry: "electron/main.ts",
    vite: {
      plugins: [electronActions({ env: "main" })],
    },
    preload: {
      input: "electron/preload.ts",
      vite: {
        plugins: [electronActions({ env: "preload" })],
      },
    },
  }]),
});
```

### Virtual Module Prefixes

- `electron-actions:handlers-map` — intercepted by `env:"main"` plugin; generates a data-only `{ [channel]: handlerFn }` default export consumed by `setupMain()`
- `electron-actions:channels` — intercepted by `env:"preload"` plugin; generates a data-only `{ [fnName]: channelString }` default export consumed by `setupPreload()`
- `electron-actions:non-exported-actions:<absolute-path>` — internal only; serves original source with additional `export { name }` for non-exported `"use node"` functions so `ipcMain.handle()` can reference them

## Dependencies

- `oxc-parser` and `magic-string` are runtime `dependencies`
- Uses root `bunfig.toml` with `linker = "hoisted"` for workspace management

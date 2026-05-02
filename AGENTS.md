# AGENTS.md - Repository Guide

## Build Commands

```bash

pnpm exec tsc --noEmit    # Check for TypeScript errors (run after any source changes)
pnpm run dev          # Build with watch mode (tsdown)
pnpm run build        # Build library
pnpm run check        # Biome check --write
pnpm run check:unsafe # Biome check --write --unsafe
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
import { ipcMain } from "electron"
import path from "node:path"

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
│   ├── index.ts              # Vite plugin entry: electronActions(), resolveId, load, transform hooks
│   ├── types.ts              # ElectronActionsOptions type
│   ├── virtual.d.ts          # Ambient type declarations for virtual modules (electron-actions:preload)
│   ├── plugin/
│   │   ├── ast.ts            # AST utilities (collectIdentifierPositions)
│   │   ├── channel.ts        # channelName() — derives IPC channel from file path + function name
│   │   ├── directives.ts     # checkFileLevelDirective(), checkFunctionLevelDirective()
│   │   ├── handlerModule.ts  # generateHandlerModule() — codegen for electron-actions:handlers
│   │   ├── handlers.ts       # extractHandlerNames(), extractNonExportedHandlerNames()
│   │   ├── ipcInvoker.ts     # ipcInvokerFn(), ipcInvokerArrow() — renderer stub generators
│   │   ├── preloadModule.ts  # generatePreloadModule() — codegen for electron-actions:preload
│   │   ├── scanner.ts        # scanForHandlers() — filesystem scan for "use node" files
│   │   └── transform.ts      # transform(), transformFileLevelDirective(), transformFunctionLevelDirective()
│   └── preload/
│       └── index.ts          # createElectronActionsRenderer() — exposes window.__ea via contextBridge
├── src/__tests__/
│   └── transform.test.ts     # vitest tests covering transform and directive detection
├── dist/                     # Built output (gitignored)
│   ├── index.mjs             # ESM build (main entry)
│   ├── index.cjs             # CJS build (main entry)
│   ├── index.d.mts           # ESM type declarations
│   ├── index.d.cts           # CJS type declarations
│   └── preload/
│       └── index.mjs         # ESM build (preload entry)
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

### Virtual Module: `electron-actions:handlers`

Import this in the Electron main process to register all `ipcMain.handle()` calls:

```ts
import "electron-actions:handlers"
```

The plugin scans `scanDirs` (default `["src"]`) at build time to discover all handlers. Non-exported `"use node"` functions are automatically re-exported in the `ea-raw:` shim so `ipcMain.handle()` can reference them.

### Virtual Module: `electron-actions:preload`

Imported automatically by `electron-actions/preload` inside the preload build. Exports a
`channels` map of `{ [fnName]: channelString }` so `createElectronActionsRenderer()` can
wire up individual named functions via `contextBridge` without ever exposing channel
strings to the renderer.

### Renderer Bridge

In the preload script:

```ts
import { contextBridge, ipcRenderer } from "electron"
import { createElectronActionsRenderer } from "electron-actions/preload"

createElectronActionsRenderer(contextBridge, ipcRenderer)
```

This exposes `window.__ea` via `contextBridge.exposeInMainWorld` as an object of individually
named functions, each locked to a single pre-determined IPC channel. The renderer cannot
invoke arbitrary channels — it can only call the specific named functions declared with
`"use node"`.

### Plugin Registration

The plugin must be registered in **three places** in `vite.config.ts` — once for the
renderer build, once for the main process build, and once for the preload build (all run
in isolated Vite instances):

```ts
import { electronActions } from "vite-plugin-electron-actions"

export default defineConfig({
  plugins: [electronActions()],  // renderer
  // ...
  electron([{
    entry: "electron/main.ts",
    vite: {
      plugins: [electronActions()],  // main process
    },
  }]),
  // preload
  preload: {
    input: "electron/preload.ts",
    vite: {
      plugins: [electronActions()],  // preload — needed for electron-actions:preload virtual module
    },
  },
})
```

### Virtual Module Prefixes

- `electron-actions:handlers` — virtual module for main process handler registration
- `electron-actions:preload` — virtual module for preload script; exports the `channels` map
- `ea-raw:<absolute-path>` — serves original untransformed source to the main process build; appends `export { name }` for non-exported `"use node"` functions

## Dependencies

- `oxc-parser` and `magic-string` are runtime `dependencies`
- Uses root `bunfig.toml` with `linker = "hoisted"` for workspace management

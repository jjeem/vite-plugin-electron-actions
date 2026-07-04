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
│   ├── index.ts              # Vite plugin entry: electronActions() returns renderer/main/preload plugins
│   ├── types.ts              # ElectronActionsOptions and ElectronActionsPlugins types
│   ├── virtual.d.ts          # Ambient type declarations for vite-plugin-electron-actions:channels (string[]) and vite-plugin-electron-actions:load-handlers
│   ├── preload.ts            # setupPreload() + Window.$$vitePluginElectronActions global type; imports vite-plugin-electron-actions:channels
│   ├── plugin/
│   │   ├── ast.ts            # AST utilities (collectIdentifierPositions)
│   │   ├── channel.ts        # channelName() — derives IPC channel from file path, function name, and optional prefix
│   │   ├── codegen.ts        # generateChannelsModule(), generateHandlersLoaderModule(), ipcInvokerFn(), ipcInvokerArrow() — codegen
│   │   ├── directives.ts     # checkFileLevelDirective(), checkFunctionLevelDirective()
│   │   ├── handlers.ts       # extractHandlerNames() — used by scanner
│   │   ├── scanner.ts        # scanForHandlers() — filesystem scan for "use node" files
│   │   └── transform.ts      # transform(), transformFileLevelDirective(), transformFunctionLevelDirective(), transformForMain(), checkReservedIdentifierUsage()
│   ├── main/
│   │   ├── action-context.ts  # getActionContext() + $$vitePluginElectronActions_runAction()
│   │   └── index.ts          # setupMain(options?) → Promise<true>, notifyWindows(), mainSetupPromise — dynamically imports load-handlers; resolves after all ipcMain.handle() calls are registered
├── src/__tests__/
│   └── transform.test.ts     # vitest tests covering transform, directives, and codegen
├── dist/                     # Built output (gitignored)
│   ├── index.mjs             # ESM build (main entry)
│   ├── index.cjs             # CJS build (main entry)
│   ├── index.d.mts           # ESM type declarations
│   ├── index.d.cts           # CJS type declarations
│   ├── main/
│   │   └── index.mjs         # ESM build (main entry — setupMain)
│   └── preload.mjs           # ESM build (preload entry — setupPreload)
```

## How the Plugin Works

### Directives

Two modes of marking server-side (Node.js) code:

**File-level**: `"use node"` at the top of the file. All exported async functions become IPC calls. Sync function exports and re-exports (`export { foo }`) throw a build error. Other exports are silently stripped.

```ts
"use node"

export async function getUser(id: string) {
  return db.user.findUnique({ where: { id } })
}
```

**Function-level**: `"use node"` inside individual function bodies. Only those functions become stubs (ipcInvokers); everything else is preserved. Works on exported AND non-exported functions. The function must be `async` — sync functions with the directive throw a build error. Imports used exclusively inside `"use node"` bodies are automatically removed from the renderer output.

```ts
const writeToFile = async () => {
  "use node"
  await fs.writeFile("test.txt", "Hello, world!")
}
```

### Virtual Module: `vite-plugin-electron-actions:load-handlers`

Intercepted by the `env:"main"` plugin. Generates one side-effect import per `"use node"` file discovered by the scanner. Importing this module causes every handler file to load, which triggers the `ipcMain.handle()` calls injected directly into each file by `transformForMain()`. `setupMain()` in `src/main/index.ts`. `setupMain()` returns `mainSetupPromise` (`Promise<true>`) for API consistency:

```ts
import { setupMain } from "vite-plugin-electron-actions/main";
setupMain();
```

Each `"use node"` file in the main build is transformed by `transformForMain()` to keep its real implementation and append `ipcMain.handle()` calls for each handler — no centralized map needed. Each generated handler wraps the real function with `$$vitePluginElectronActions_runAction(event, () => handler(...args))`, which lets `getActionContext()` expose the current `IpcMainInvokeEvent` during the action. Because handlers self-register at module load time, side effects run exactly once even if the file is also imported elsewhere in main (the bundler deduplicates by module ID).

### Virtual Module: `vite-plugin-electron-actions:channels`

Intercepted by the `env:"preload"` plugin. Generates a data-only default export of
`[channelString, ...]` (an array). The full channel string (including any prefix) is used
as both the `window.$$vitePluginElectronActions` key and the `ipcRenderer.invoke` argument. `setupPreload()` in
`src/preload.ts` iterates this array and wires up `contextBridge.exposeInMainWorld("$$vitePluginElectronActions", api)`:

```ts
import { setupPreload } from "vite-plugin-electron-actions/preload";
setupPreload();
```

The plugin scans the required `files` glob(s) at build time to discover all handlers.

### Virtual Module: `vite-plugin-electron-actions/preload`

Intercepted by the `env:"preload"` plugin. The generated `setupPreload()` body imports
`contextBridge` and `ipcRenderer` from `"electron"` and wires up every discovered handler
as a named function on `window.$$vitePluginElectronActions`. Call it once in your preload script:

```ts
import { setupPreload } from "vite-plugin-electron-actions/preload";
setupPreload();
```

### Renderer Bridge

`setupPreload()` exposes `window.$$vitePluginElectronActions` via `contextBridge.exposeInMainWorld` as an object
of individually named functions, each locked to a single pre-determined IPC channel. The
renderer cannot invoke arbitrary channels — it can only call the specific named functions
declared with `"use node"`.

### Plugin Registration

Call `electronActions()` once, then register the returned plugins in **three places** in
`vite.config.ts` — once for the renderer build, once for the main process build, and once
for the preload build (all run in isolated Vite instances):

```ts
import { electronActions } from "vite-plugin-electron-actions";

const { renderer, main, preload } = electronActions({
  files: ["src/**/*.{js,ts,jsx,tsx}"],
});

export default defineConfig({
  plugins: [renderer],
  // ...
  electron([{
    entry: "electron/main.ts",
    vite: {
      plugins: [main],
    },
    preload: {
      input: "electron/preload.ts",
      vite: {
        plugins: [preload],
      },
    },
  }]),
});
```

### Virtual Module Prefixes

- `vite-plugin-electron-actions:load-handlers` — intercepted by `env:"main"` plugin; generates side-effect imports of all `"use node"` files; imported by `vite-plugin-electron-actions/main`
- `vite-plugin-electron-actions:channels` — intercepted by `env:"preload"` plugin; generates a data-only `[channelString, ...]` array default export consumed by `setupPreload()`

## Dependencies

- `oxc-parser` and `magic-string` are runtime `dependencies`
- Uses root `bunfig.toml` with `linker = "hoisted"` for workspace management

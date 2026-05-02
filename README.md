# vite-plugin-electron-actions

A Vite plugin that lets you mark functions with a `"use node"` directive so they run in the Electron main process — similar to React `"use server"`. The plugin transforms marked functions into IPC calls in the renderer and automatically registers `ipcMain.handle()` calls in the main process.

## Installation

```bash
npm install vite-plugin-electron-actions
```

## Setup

### With `vite-plugin-electron`

Register the plugin **three times** — once for the renderer build, once for the main process build, and once for the preload build. All three run in isolated Vite instances and each needs the plugin.

```typescript
// vite.config.ts
import { electronActions } from "vite-plugin-electron-actions"
import electron from "vite-plugin-electron"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    electronActions(), // renderer
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          plugins: [electronActions()], // main process
        },
        preload: {
          input: "electron/preload.ts",
          vite: {
            plugins: [electronActions()], // preload
          },
        },
      },
    ]),
  ],
})
```

### Without `vite-plugin-electron` (pure Vite)

If you are not using `vite-plugin-electron`, you can wire up the three builds manually with separate Vite configs.

**`vite.config.ts`** (renderer):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [electronActions()],
})
```

**`vite.main.config.ts`** (main process):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: {
      entry: "electron/main.ts",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
  plugins: [electronActions()],
})
```

**`vite.preload.config.ts`** (preload):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: {
      entry: "electron/preload.ts",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
  plugins: [electronActions()],
})
```

The plugin must be in the preload config so the `electron-actions:preload` virtual module resolves correctly.

### Main process

Import the virtual module to register all `ipcMain.handle()` calls:

```typescript
// electron/main.ts
import "electron-actions:handlers"
```

### Preload script

Expose the IPC bridge to the renderer:

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from "electron"
import { createElectronActionsRenderer } from "vite-plugin-electron-actions/preload"

createElectronActionsRenderer(contextBridge, ipcRenderer)
```

This exposes `window.__ea` via `contextBridge.exposeInMainWorld` as an object of individually named functions. Each function is locked to a single pre-determined IPC channel — the renderer cannot invoke arbitrary channels.

---

## The `"use node"` directive

### Function-level

Place `"use node"` inside a function body. Only that function becomes an IPC call — everything else in the file is left untouched. Works on both exported and non-exported functions.

Imports used **exclusively** inside `"use node"` bodies are automatically removed from the renderer output.

```typescript
// src/counter.ts
import fs from "node:fs/promises"

// This runs in the main process
const writeToFile = async () => {
  "use node"
  await fs.writeFile("output.txt", "hello")
}

// This stays in the renderer
export function setupCounter(el: HTMLButtonElement) {
  el.addEventListener("click", () => writeToFile())
}
```

### File-level

Place `"use node"` at the very top of the file (before any imports). Every exported async function becomes an IPC call. All imports are stripped from the renderer output.

```typescript
// src/api.ts
"use node"

import { db } from "./db"

export async function getUser(id: string) {
  return db.users.findUnique({ where: { id } })
}

export async function createUser(name: string) {
  return db.users.create({ data: { name } })
}
```

**Constraints in file-level mode** — the following will throw a build error:

- Sync function exports: `export function foo() {}`
- Non-async variable exports: `export const x = 5`
- Class exports: `export class Foo {}`
- Re-exports: `export { foo }`

Type/interface exports (`export type Foo`, `export interface Bar`) are silently stripped.

---

## Plugin options

```typescript
electronActions({
  // Files to include (default: all .js/.ts/.jsx/.tsx)
  include: /\.[jt]sx?$/,

  // Files to exclude
  exclude: /node_modules/,

  // Directories to scan for handlers (default: ["src"])
  // Paths are relative to the Vite root.
  scanDirs: ["src"],
})
```

> [!IMPORTANT]
> `scanDirs` defaults to `["src"]` and should point to the directories that contain your `"use node"` files — typically your renderer source tree. It is used by the **main process build** to discover all handlers at build time by walking the filesystem directly, independently of the renderer's transform pass. If your `"use node"` files live outside `src/` (e.g. in `app/` or `packages/renderer/src/`), you must set this option accordingly, otherwise the main process will not register those handlers.

---

## Error handling

Errors thrown inside `"use node"` functions are serialized over IPC and re-thrown in the renderer:

```typescript
export async function getUser(id: string) {
  "use node"
  if (!id) throw new Error("ID is required")
  return db.users.findUnique({ where: { id } })
}

// In the renderer:
try {
  const user = await getUser("")
} catch (err) {
  console.error(err.message) // "ID is required"
}
```

---

## How it works

**Renderer transform** (`src/api.ts` before → after):

```typescript
// Before (source)
"use node"
import { db } from "./db"

export async function getUser(id: string) {
  return db.users.findUnique({ where: { id } })
}

// After (renderer bundle) — channel strings are never present here
export async function getUser(...args) {
  return await window.__ea["getUser"](...args)
}
```

**Preload virtual module** (`electron-actions:preload`):

```typescript
// Generated at build time — maps function names to their IPC channels
export const channels = {
  "getUser": "a3f2b1c4:getUser",
}
```

`createElectronActionsRenderer` reads this map and wires up a named function per entry via `contextBridge`, so channel strings are only ever present in the preload and main process bundles — never in the renderer.

**Main process virtual module** (`electron-actions:handlers`):

```typescript
import { ipcMain } from "electron"
import * as _ea0 from "ea-raw:/abs/path/src/api.ts"

ipcMain.handle("a3f2b1c4:getUser", (_event, ...args) => _ea0["getUser"](...args))
```

The `ea-raw:` prefix tells the plugin to serve the **original untransformed** source to the main process build so the real implementation runs there.

### IPC channel names

Channel names are automatically derived from a hash of the absolute file path and function name:

```
src/users/api.ts → getUser   becomes   "a3f2b1c4:getUser"
```

You never reference channel names directly — this is handled automatically. Channel strings do not appear in the renderer bundle at all.

---

## License

MIT

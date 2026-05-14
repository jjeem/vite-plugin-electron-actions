# vite-plugin-electron-actions

A Vite plugin that lets you mark functions with a `"use node"` directive so they run in the Electron main process — similar to React `"use server"`. The plugin transforms marked functions into IPC calls in the renderer and automatically registers `ipcMain.handle()` calls in the main process.

> [!CAUTION]
> This package is in early development. The API and internal behavior are subject to frequent changes. Do not use in production without expecting breaking changes in any version.

## Installation

```bash
npm install vite-plugin-electron-actions
```

## Setup

The plugin must be registered **three times** — once for each Vite build environment — each with the appropriate `env` value.

### With `vite-plugin-electron`

```typescript
// vite.config.ts
import { electronActions } from "vite-plugin-electron-actions"
import electron from "vite-plugin-electron"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    electronActions({ env: "renderer" }),
    electron([
      {
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
      },
    ]),
  ],
})
```

### Without `vite-plugin-electron` (pure Vite)

**`vite.config.ts`** (renderer):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [electronActions({ env: "renderer" })],
})
```

**`vite.main.config.ts`** (main process):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: "electron/main.ts", formats: ["cjs"] },
    rollupOptions: { external: ["electron"] },
  },
  plugins: [electronActions({ env: "main" })],
})
```

**`vite.preload.config.ts`** (preload):

```typescript
import { electronActions } from "vite-plugin-electron-actions"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: "electron/preload.ts", formats: ["cjs"] },
    rollupOptions: { external: ["electron"] },
  },
  plugins: [electronActions({ env: "preload" })],
})
```

### Main process

Call `setupMain()` once during app startup to register all `ipcMain.handle()` calls:

```typescript
// electron/main.ts
import { setupMain } from "vite-plugin-electron-actions/main"

app.whenReady().then(() => {
  setupMain()
  // ...
})
```

### Preload script

Call `setupPreload()` to expose all `"use node"` functions to the renderer via `contextBridge`:

```typescript
// electron/preload.ts
import { setupPreload } from "vite-plugin-electron-actions/preload"

setupPreload()
```

This exposes `window.__ea` via `contextBridge.exposeInMainWorld` as an object of individually named functions. Each function is locked to a single pre-determined IPC channel — the renderer cannot invoke arbitrary channels.

---

## The `"use node"` directive

### Function-level

Place `"use node"` inside a function body. Only that function becomes an IPC call — everything else in the file is left untouched. Works on both exported and non-exported functions.

The function **must be `async`** — a sync function with `"use node"` is a build error.

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
export function setupFile(el: HTMLButtonElement) {
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

---

## Rules

These rules apply regardless of whether you use file-level or function-level `"use node"`:

- **`async` is required.** Every `"use node"` function must be declared `async`. A sync function with the directive is a build error.
- **Top-level only.** Only top-level function declarations and variable declarations are processed. Functions nested inside blocks, conditionals, loops, or other functions are silently ignored — the directive has no effect there.

Additional constraints in **file-level** mode (any of these is a build error):

- Sync function/arrow-function exports: `export function foo() {}`
- Re-exports: `export { foo }`

Other exports (`export const x = 5`) are silently stripped from the Renderer bundle only.

---

## Security

`"use node"` handlers run in the main process and have full Node.js access. Their arguments arrive over IPC from the renderer, which is a web context — if the renderer is ever compromised (e.g. via XSS or a malicious dependency), an attacker can call any handler with arbitrary arguments.

- **Validate all inputs.** Check argument count, types, and value ranges before acting on them. Never assume the caller passed well-formed data.
- **Apply access control where needed.** If a handler performs a sensitive operation (filesystem writes, network requests, spawning processes), add appropriate checks rather than relying on the renderer to gate access.
- **Channel names are fixed at build time.** The IPC channels are derived from a hash of the file path and function name and are not user-controllable, which prevents channel-name spoofing — but this does not protect against argument manipulation.

---

## Plugin options

```typescript
electronActions({
  // Required: which Vite build environment this instance serves
  env: "renderer" | "main" | "preload",

  // Files to include (default: all .js/.ts/.jsx/.tsx)
  include: /\.[jt]sx?$/,

  // Files to exclude
  exclude: /node_modules/,

  // Directories to scan for handlers (default: ["src"])
  // Paths are relative to the Vite root.
  scanDirs: ["src"],

  // Optional prefix prepended to every IPC channel name (default: "")
  // Useful when multiple plugin instances need isolated handler sets
  // (e.g. separate renderer windows).
  channelPrefix: "my-app:",
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

// After (renderer bundle)
export async function getUser(...args) {
  return await window.__ea["a3f2b1c4:getUser"](...args)
}
```

**`setupMain()` — generated at build time**:

```typescript
// vite-plugin-electron-actions:handlers-map (generated — data only)
import * as _ea0 from "/abs/path/src/api.ts"

export default {
  "a3f2b1c4:getUser": _ea0["getUser"],
}
```

`setupMain()` in `src/main/index.ts` iterates this map and calls `ipcMain.handle()` for each entry.

**`setupPreload()` — generated at build time**:

```typescript
// vite-plugin-electron-actions:channels (generated — data only)
export default [
  "a3f2b1c4:getUser",
]
```

`setupPreload()` in `src/preload/index.ts` iterates this array and wires up `contextBridge.exposeInMainWorld("__ea", api)`.

### IPC channel names

Channel names are automatically derived from a hash of the absolute file path and function name:

```
src/users/api.ts → getUser   becomes   "a3f2b1c4:getUser"
```

With a `channelPrefix` set to `"my-app:"`:

```
src/users/api.ts → getUser   becomes   "my-app:a3f2b1c4:getUser"
```

You never reference channel names directly — this is handled automatically. Channel strings do not appear in the renderer bundle at all.

---

## License

MIT

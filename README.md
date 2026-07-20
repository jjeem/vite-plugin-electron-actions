# vite-plugin-electron-actions

This plugin brings a React `"use server"`-style workflow to Electron. Add `"use node"` to an async function to run it in the main process while calling it like a local function from the renderer. The plugin generates the IPC bridge, replaces the renderer implementation with an IPC call, and registers the corresponding `ipcMain` handler.

```typescript
// renderer.ts
import { readFile } from "node:fs/promises"

export async function readConfig() {
  "use node"

  return readFile("config.json", "utf8")
}

// Called from the renderer; executed in the main process
const config = await readConfig()
```

## Installation

```bash
npm install -D vite-plugin-electron-actions
```

## Usage

### 1. Setup

Configure `electronActions()` in a shared file, then import each returned plugin into its matching Vite build environment.

**`electron-actions.config.ts`**:

```typescript
import { electronActions } from "vite-plugin-electron-actions"

export const { renderer, main, preload } = electronActions({
  // Match every renderer file where the directive may be used.
  files: ["src/**/*.{js,ts,jsx,tsx}"],
})
```

#### A) With `vite-plugin-electron`

```typescript
// vite.config.ts
import electron from "vite-plugin-electron"
import { defineConfig } from "vite"
import { main, preload, renderer } from "./electron-actions.config"

export default defineConfig({
  plugins: [
    renderer,
    electron([
      {
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
      },
    ]),
  ],
})
```

#### B) Without `vite-plugin-electron` (pure Vite)

**`vite.config.ts`** (renderer):

```typescript
import { defineConfig } from "vite"
import { renderer } from "./electron-actions.config"

export default defineConfig({
  plugins: [renderer],
})
```

**`vite.main.config.ts`** (main process):

```typescript
import { defineConfig } from "vite"
import { main } from "./electron-actions.config"

export default defineConfig({
  build: {
    lib: { entry: "electron/main.ts" },
    rollupOptions: { external: ["electron"] },
  },
  plugins: [main],
})
```

**`vite.preload.config.ts`** (preload):

```typescript
import { defineConfig } from "vite"
import { preload } from "./electron-actions.config"

export default defineConfig({
  build: {
    lib: { entry: "electron/preload.ts" },
    rollupOptions: { external: ["electron"] },
  },
  plugins: [preload],
})
```

### 2. Main process

Call `setupMain()` once during app startup to register all `ipcMain.handle()` calls. It returns a `Promise<true>` that resolves once all handlers are registered (or rejects on error). The same promise is available as `mainSetupPromise` exported from `"vite-plugin-electron-actions/main"` if you need to await it from elsewhere.

Optionally pass a `windows` array — each `BrowserWindow` will receive a `[channelPrefix]main-setup-complete` IPC event once handlers are ready and the window finishes loading. With the default prefix, the event is `$$electron-actions:main-setup-complete`:

```typescript
// electron/main.ts
import { setupMain, mainSetupPromise, notifyWindows } from "vite-plugin-electron-actions/main"

app.whenReady().then(async () => {
  const win = new BrowserWindow({ /* ... */ })
  await setupMain({ windows: [win] })
  // all ipcMain.handle() calls are now registered
})
```

### 3. Preload script

Call `setupPreload()` to expose all `"use node"` functions to the renderer via `contextBridge`:

```typescript
// electron/preload.ts
import { setupPreload } from "vite-plugin-electron-actions/preload"

setupPreload()
```

This exposes `window.$$vitePluginElectronActions` via `contextBridge.exposeInMainWorld` as an object of individually named functions. Each function is locked to a single pre-determined IPC channel — the renderer cannot invoke arbitrary channels.

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

### Action context

Use `getActionContext()` inside a `"use node"` function when you need access to the Electron `IpcMainInvokeEvent` that called it:

```typescript
import { getActionContext } from "vite-plugin-electron-actions/main"

export async function getSenderUrl() {
  "use node"
  const { event } = getActionContext()
  return event.senderFrame.url
}
```

Internally, this uses Node's `AsyncLocalStorage` to keep the current IPC event
available through normal async work inside the action.

> [!WARNING]
> `getActionContext()` throws if it is called outside a running `"use node"` action.
> This includes calling the same function directly from the main process, because
> there is no IPC event context in that case.

### Main setup notification

The renderer can subscribe to `window.$$onMainSetupComplete` to know when all action handlers have been registered:

```typescript
window.$$onMainSetupComplete((ready) => {
  if (ready) {
    // "use node" actions are ready to call
  }
})
```

The callback is triggered for windows passed to `setupMain({ windows })` or `notifyWindows()`, after the window finishes loading. This is an event rather than persistent state, so a listener registered after the notification is sent will not receive it.

---

## Rules

These rules apply regardless of whether you use file-level or function-level `"use node"`:

- **`async` is required:** Every `"use node"` function must be declared `async`. A sync function with the directive is a build error.
- **Top-level only:** Only top-level function declarations and variable declarations are processed. Functions nested inside blocks, conditionals, loops, or other functions are silently ignored — the directive has no effect there.

In **file-level** mode, only async actions, type aliases, and interfaces may be exported; any other export is a build error.

---

## Security

`"use node"` handlers run in the main process and have full Node.js access. Their arguments arrive over IPC from the renderer, which is a web context — if the renderer is ever compromised (e.g. via XSS or a malicious dependency), an attacker can call any handler with arbitrary arguments.

- **Validate all inputs.** Check argument count, types, and value ranges before acting on them. Never assume the caller passed well-formed data.
- **Apply access control where needed.** If a handler performs a sensitive operation (filesystem writes, network requests, spawning processes), add appropriate checks rather than relying on the renderer to gate access.

**Channel names are fixed at build time.** The IPC channels are derived from a hash of the file path and function name and are not user-controllable, which prevents channel-name spoofing. The `channelPrefix` namespaces these generated channels to avoid collisions with your app's own IPC channels, third-party libraries, or other plugin instances. Keep the default prefix unless you need a custom namespace; if you override it, choose a prefix unique to that plugin instance.

---

## Plugin options

```typescript
electronActions({
  // Required: glob patterns to process and scan for handlers.
  // Paths are relative to the Vite root. Negated patterns exclude files.
  // At least one non-negated include pattern is required.
  files: ["src/**/*.{js,ts,jsx,tsx}", "!src/**/*.test.{ts,tsx}"],

  // Optional prefix prepended to every IPC channel name (default: "$$electron-actions:")
  // Also prefixes the main setup complete event.
  // Useful when multiple plugin instances need isolated handler sets
  // (e.g. separate renderer windows).
  channelPrefix: "my-app:",
})
```

> [!IMPORTANT]
> `files` is required and should match every file that can contain `"use node"` handlers — typically your renderer source tree. It is used by the **main process build** to discover all handlers at build time by globbing the filesystem directly, independently of the renderer's transform pass. If your `"use node"` files live outside `src/` (e.g. in `app/` or `packages/renderer/src/`), set this option accordingly, otherwise the main process will not register those handlers.

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

### IPC channel names

Channel names use the default `"$$electron-actions:"` prefix followed by a hash of the absolute file path and function name:

```
src/users/api.ts → getUser   becomes   "$$electron-actions:a3f2b1c4d5e6:getUser"
```

With a `channelPrefix` set to `"my-app:"`:

```
src/users/api.ts → getUser   becomes   "my-app:a3f2b1c4d5e6:getUser"
```

You never reference channel names directly — this is handled automatically.

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
  return await window.$$vitePluginElectronActions["$$electron-actions:a3f2b1c4d5e6:getUser"](...args)
}
```

**`setupMain()` — main process build**:

The plugin transforms each `"use node"` file in the main process build to keep the real implementation and inject `ipcMain.handle()` calls directly into the file:

```typescript
// src/api.ts — after main-process transform
import { ipcMain as $$vitePluginElectronActions_ipcMain } from "electron"
import { $$vitePluginElectronActions_runAction } from "vite-plugin-electron-actions/main"
import { db } from "./db"

export async function getUser(id: string) {
  return db.users.findUnique({ where: { id } })
}

$$vitePluginElectronActions_ipcMain.handle(
  "$$electron-actions:a3f2b1c4d5e6:getUser",
  (event, ...args) => $$vitePluginElectronActions_runAction(event, () => getUser(...args)),
)
```

`vite-plugin-electron-actions:load-handlers` is a virtual module that contains one side-effect import per `"use node"` file. It is imported by `vite-plugin-electron-actions/main`

```typescript
// vite-plugin-electron-actions:load-handlers (generated)
import "/abs/path/src/api.ts"
```

Because the `load-handlers` module is a **static** import of `vite-plugin-electron-actions/main`, all handler files are in the primary module graph and are evaluated synchronously at startup. Side effects run exactly once — the bundler deduplicates by module ID even if the file is also imported elsewhere in main.

**`setupPreload()` — generated at build time**:

```typescript
// vite-plugin-electron-actions:channels (generated — data only)
export default [
  "$$electron-actions:a3f2b1c4d5e6:getUser",
]
```

`setupPreload()` in `src/preload.ts` iterates this array and wires up `contextBridge.exposeInMainWorld("$$vitePluginElectronActions", api)`.

---

## License

MIT

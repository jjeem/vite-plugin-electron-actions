import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/preload/index.ts", "src/main/index.ts"],
  dts: true,
  format: ["esm", "cjs"],
  deps: {
    neverBundle: ["vite-plugin-electron-actions:channels", "vite-plugin-electron-actions:handlers-map"],
  },
});

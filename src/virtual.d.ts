declare module "vite-plugin-electron-actions:channels" {
  const channels: string[];
  export default channels;
}

declare module "vite-plugin-electron-actions:handlers-map" {
  const handlers: Record<string, (...args: unknown[]) => unknown>;
  export default handlers;
}

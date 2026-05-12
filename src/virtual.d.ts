declare module "electron-actions:channels" {
  const channels: string[];
  export default channels;
}

declare module "electron-actions:handlers-map" {
  const handlers: Record<string, (...args: unknown[]) => unknown>;
  export default handlers;
}

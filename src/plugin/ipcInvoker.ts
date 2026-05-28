// ── IPC invoker generators ─────────────────────────────────────

export function ipcInvokerFn(name: string, key: string): string {
  return `async function ${name}(...args) {
  return await window.__ea["${key}"](...args);
}`;
}

export function ipcInvokerArrow(name: string, key: string): string {
  return `const ${name} = async (...args) => {
  return await window.__ea["${key}"](...args);
}`;
}

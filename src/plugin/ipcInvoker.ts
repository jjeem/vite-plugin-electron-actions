// ── IPC invoker generators ─────────────────────────────────────

export function ipcInvokerFn(name: string): string {
  return `async function ${name}(...args) {
  return await window.__ea[${JSON.stringify(name)}](...args);
}`;
}

export function ipcInvokerArrow(name: string): string {
  return `const ${name} = async (...args) => {
  return await window.__ea[${JSON.stringify(name)}](...args);
}`;
}

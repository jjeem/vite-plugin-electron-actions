// ── IPC invoker generators ─────────────────────────────────────

export function ipcInvokerFn(name: string, actionId: string): string {
  return `async function ${name}(...args) {
  return await window.__ea[${JSON.stringify(actionId)}](...args);
}`;
}

export function ipcInvokerArrow(name: string, actionId: string): string {
  return `const ${name} = async (...args) => {
  return await window.__ea[${JSON.stringify(actionId)}](...args);
}`;
}

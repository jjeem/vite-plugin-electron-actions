import { afterEach, describe, expect, test, vi } from "vitest";
import { onMainSetupComplete } from "../renderer.ts";

describe("onMainSetupComplete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("delegates to the preload bridge and returns its unsubscribe function", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const callback = vi.fn();

    vi.stubGlobal("window", {
      $$vitePluginElectronActions: {
        onMainSetupComplete: subscribe,
      },
    });

    expect(onMainSetupComplete(callback)).toBe(unsubscribe);
    expect(subscribe).toHaveBeenCalledWith(callback);
  });
});

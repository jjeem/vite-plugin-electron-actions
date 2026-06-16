import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, test } from "vitest";
import {
  $$vitePluginElectronActions_runAction,
  getActionContext,
} from "../index.ts";

describe("action context", () => {
  test("throws outside an action", () => {
    expect(() => getActionContext()).toThrow(/can only be called/);
  });

  test("exposes the event while an action is running", async () => {
    const event = { sender: {} } as unknown as IpcMainInvokeEvent;

    await $$vitePluginElectronActions_runAction(event, async () => {
      await Promise.resolve();
      expect(getActionContext()).toEqual({ event });
    });
  });
});

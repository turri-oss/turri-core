import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSettings, type SettingsOptions } from "../src/settings.ts";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-settings-pi-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** /settings on a stand-in pi, in a chat that picks pi's own settings, the last entry of its list. */
async function pickPiSettings(openPiMenu?: SettingsOptions["openPiMenu"]) {
  let command: { handler: (args: string, ctx: never) => Promise<void> } | undefined;
  const pi = {
    on: () => {},
    registerCommand: (name: string, options: typeof command) => {
      if (name === "settings") command = options;
    },
    registerTool: () => {},
  };
  const live = { chatModel: async () => undefined, codingModel: () => undefined, parallelJobs: () => undefined };
  registerSettings(pi as never, { cwd: dir, rules: () => [], chatSpec: () => undefined, live, ...(openPiMenu !== undefined ? { openPiMenu } : {}) });
  const said: string[] = [];
  const ctx = {
    hasUI: true,
    modelRegistry: { getAvailable: () => [], getAll: () => [], hasConfiguredAuth: () => true },
    ui: {
      notify: (message: string) => said.push(message),
      select: async (_title: string, options: string[]) => options.at(-1),
      input: async () => undefined,
    },
  };
  await command!.handler("", ctx as never);
  return said;
}

describe("/settings and pi's own settings", () => {
  it("opens pi's own settings through the screen's menu, saying nothing once it opened", async () => {
    let opened = 0;
    const said = await pickPiSettings(() => {
      opened += 1;
      return true;
    });
    expect(opened).toBe(1);
    expect(said).toEqual([]);
  });

  it("says they open only in the terminal's chat when the screen has no menu, or there is no screen", async () => {
    expect(await pickPiSettings(() => false)).toEqual(["pi's own settings open only in the terminal's chat."]);
    expect(await pickPiSettings()).toEqual(["pi's own settings open only in the terminal's chat."]);
  });
});

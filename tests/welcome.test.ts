import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTurriCore } from "../src/extension.ts";

const cwd = process.cwd();
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turri-welcome-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

/** The terminal's two chats, turri's extension built into each: `typed` hands a chat's `input` handlers what pi hands them. */
async function terminal() {
  const core = createTurriCore();
  const inputs: Array<Array<(event: InputEvent) => unknown>> = [];
  core.setDriver({
    terminal: true,
    async create() {
      const own: Array<(event: InputEvent) => unknown> = [];
      inputs.push(own);
      const on = (event: string, handler: (event: InputEvent) => unknown) => {
        if (event === "input") own.push(handler);
      };
      core.extension(new Proxy({ on }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as unknown as ExtensionAPI);
    },
    async dispose() {},
  });
  const first = await core.open();
  const second = await core.open();
  const typed = (chat: number, event: Omit<InputEvent, "type">) => {
    for (const handler of inputs[chat]!) handler({ type: "input", ...event });
  };
  const welcome = () => [first.id, second.id].map((id) => core.welcomeVisible(id));
  return { typed, welcome };
}

describe("the terminal's welcome", () => {
  it("stays through a blank submission and a message turri sends itself, and goes from every chat with the first thing the person says", async () => {
    const { typed, welcome } = await terminal();
    expect(welcome()).toEqual([true, false]);
    typed(1, { source: "interactive", text: "   " });
    typed(1, { source: "extension", text: "Pulse 1 landed." });
    expect(welcome()).toEqual([true, false]);
    typed(1, { source: "interactive", text: "Build the board." });
    expect(welcome()).toEqual([false, false]);
  });

  it("goes with a picture sent without a word", async () => {
    const { typed, welcome } = await terminal();
    typed(0, { source: "interactive", text: "", images: [{ type: "image", data: "", mimeType: "image/png" }] });
    expect(welcome()).toEqual([false, false]);
  });
});

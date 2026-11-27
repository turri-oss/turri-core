import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePlain } from "./test-plain.ts";
import { recordHistory } from "../src/regenerate/lineage.ts";
import type { LaunchAgentInput } from "../src/launch-agent.ts";
import type { TurriEvent } from "../src/session.ts";

/**
 * What a session sends as it goes on, unasked: a launch's agent's words as they stream, and the spec map as it changes
 * while a front end shows it. No model is called: the launch agent is a stand-in that says two things and comes up.
 */

vi.mock("../src/launch-agent.ts", () => ({
  runLaunchAgent: async (input: LaunchAgentInput) => {
    input.onDelta?.("starting ");
    input.onDelta?.("the server");
    return { launched: true, summary: "runs on http://localhost:5000" };
  },
}));

const { createTurri } = await import("../src/session.ts");
const { isTurriError } = await import("../src/errors.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-session-watch-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "module: app.plain\nsentinel: false\n");
  writePlain(dir, "app.plain", "***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# greet\napp greets.\n");
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

/** The code of app, committed: what a launch exports. */
function built(): void {
  const code = join(dir, "plain_modules", "app", "code");
  mkdirSync(code, { recursive: true });
  writeFileSync(join(code, "app.py"), "print('hello')\n");
  recordHistory(code, "p1");
}

describe("a launch's output", () => {
  it("streams to the launch's onOutput and as launchOutput events, by launch and codebase", async () => {
    built();
    const events: TurriEvent[] = [];
    const turri = await createTurri({ onEvent: (event) => events.push(event) });
    try {
      const said: string[] = [];
      const launch = await turri.launches.launch(undefined, { onOutput: (text) => said.push(text) });
      expect(launch.status).toBe("launched");
      expect(said.join("")).toBe("starting the server");
      const output = events.filter((event) => event.type === "launchOutput");
      expect(output.map((event) => event.text)).toEqual(["starting ", "the server"]);
      expect(output.every((event) => event.launch === launch.id && event.codebase === "app")).toBe(true);
    } finally {
      await turri.dispose();
    }
  });

  it("is refused before anything is asked for, once its signal is aborted", async () => {
    built();
    const turri = await createTurri();
    try {
      await expect(turri.launches.launch("app.plain", { signal: AbortSignal.abort() })).rejects.toSatisfy((error: unknown) => isTurriError(error, "aborted"));
      expect(turri.launches.list()).toEqual([]);
    } finally {
      await turri.dispose();
    }
  });
});

describe("the spec map", () => {
  it("is sent as it changes while the front end shows it - its modules and items", async () => {
    const turri = await createTurri({ frontend: { shows: { map: true } } });
    try {
      const sent: Array<Extract<TurriEvent, { type: "map" }>> = [];
      turri.on("map", (event) => sent.push(event));
      const until = async (holds: () => boolean) => {
        for (let waited = 0; !holds() && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
      };
      const has = (id: string) => sent.some((event) => event.pages[0]?.items.some((item) => item.funcId === id));
      await until(() => has("greet"));
      expect(sent[0]!.pages.map((page) => page.module)).toEqual(["app"]);
      expect(has("greet")).toBe(true);
      // Changed on disk: sent again, with the change.
      writePlain(dir, "app.plain", "***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# greet\napp greets.\n\n# wave\napp waves.\n");
      await until(() => has("wave"));
      expect(has("wave")).toBe(true);
      // Sent only as it changes: no two in a row the same.
      const prints = sent.map((event) => JSON.stringify(event.pages));
      expect(prints.every((print, index) => index === 0 || print !== prints[index - 1])).toBe(true);
    } finally {
      await turri.dispose();
    }
  });

  it("is not watched for a front end that does not show it", async () => {
    const events: TurriEvent[] = [];
    const turri = await createTurri({ frontend: {}, onEvent: (event) => events.push(event) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(events.some((event) => event.type === "map")).toBe(false);
    } finally {
      await turri.dispose();
    }
  });
});

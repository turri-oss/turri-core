import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTestScripts } from "./test-scripts.ts";

/** Each chat's tools as pi holds them: registered, and active - what the model is offered. */
const chats: Array<{ registered: string[]; active: string[] }> = [];

// A chat's session, as pi makes one: turri's extension built into it, its tools registered and all active, and shown -
// session_start told - so turri sets them as the config says.
vi.mock("@earendil-works/pi-coding-agent", async (actual) => {
  const pi = await actual<typeof import("@earendil-works/pi-coding-agent")>();
  class DefaultResourceLoader {
    factories: Array<(api: unknown) => void>;
    constructor(options: { extensionFactories: Array<(api: unknown) => void> }) {
      this.factories = options.extensionFactories;
    }
    async reload() {}
  }
  const quiet = (): unknown => new Proxy(() => undefined, { get: (_target, key) => (key === "then" ? undefined : quiet()) });
  return {
    ...pi,
    DefaultResourceLoader,
    SessionManager: { create: () => ({}), open: () => ({}) },
    createAgentSession: async ({ resourceLoader }: { resourceLoader: DefaultResourceLoader }) => {
      const tools = { registered: [] as string[], active: [] as string[] };
      chats.push(tools);
      const started: Array<(event: unknown, ctx: unknown) => void> = [];
      const api = new Proxy(
        {},
        {
          get: (_target, key) => {
            if (key === "on") return (event: string, handler: (event: unknown, ctx: unknown) => void) => (event === "session_start" ? started.push(handler) : undefined);
            if (key === "registerTool") return (tool: { name: string }) => (tools.registered.push(tool.name), tools.active.push(tool.name));
            if (key === "getAllTools") return () => tools.registered.map((name) => ({ name }));
            if (key === "getActiveTools") return () => [...tools.active];
            if (key === "setActiveTools") return (names: string[]) => (tools.active = [...names]);
            return () => undefined;
          },
        },
      );
      for (const factory of resourceLoader.factories) factory(api);
      const context = new Proxy({ hasUI: false }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : quiet()) });
      const session = {
        isStreaming: false,
        isCompacting: false,
        isRetrying: false,
        isBashRunning: false,
        sessionFile: undefined,
        messages: [],
        sessionManager: { getSessionName: () => undefined },
        getSessionStats: () => ({ cost: 0 }),
        extensionRunner: { getUIContext: () => undefined, createContext: () => ({}) },
        subscribe: () => () => {},
        bindExtensions: async () => {
          for (const handler of started) {
            try {
              handler({}, context);
            } catch {
              /* a handler that wants more of the context than this one has: not what is tested */
            }
          }
        },
        abort: async () => {},
        dispose: () => {},
      };
      return { session };
    },
  };
});

const { createTurri } = await import("../src/session.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-host-conformance-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "module: app.plain\nsentinel: false\n");
  writeFileSync(join(dir, "app.plain"), "***implementation reqs***\n\n- :Implementation: is Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n");
  chats.length = 0;
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const offered = (chat: number) => ({
  conform: chats[chat]!.active.includes("conform"),
  evaluate: chats[chat]!.registered.includes("evaluate_tests"),
  turnOn: chats[chat]!.registered.includes("turn_on_conformance_tests"),
});

describe("a host looking ahead", () => {
  it("shows the next prompt and holds the plan across chats without starting a pulse", async () => {
    const planner = vi.spyOn(await import("../src/regenerate/chunk-plan.ts"), "llmChunkAgents").mockReturnValue({ group: async () => undefined, place: async () => undefined });
    writeTestScripts(dir);
    writeFileSync(join(dir, "config.turri.yaml"), `${readFileSync(join(dir, "config.turri.yaml"), "utf8")}harness-model: p/talk:medium\ncoding-model: p/code:low\n`);
    const session = await createTurri({ frontend: {} });
    try {
      expect(session.work.standing()[0]?.module).toBe("app");
      // Before any chat is open, the loop plans on the config's harness model.
      expect((await session.work.lookAhead("app.plain")).next[0]?.task).toContain("Say hello.");
      expect(planner).toHaveBeenCalledWith(expect.objectContaining({ model: "p/talk:medium" }));
      await session.chats.open();
      const { next } = await session.work.lookAhead("app.plain");
      expect(next).toHaveLength(1);
      expect(next[0]?.task).toContain("Say hello.");
      await session.chats.open();
      expect(session.work.status()).toMatchObject({ jobs: [], modules: [{ module: "app", lookedAhead: true }], planned: [{ module: "app", lookedAhead: true }] });
      expect(session.work.jobs()).toEqual([]);
      expect(existsSync(join(dir, "plain_modules", "app", "code"))).toBe(false);
      writeFileSync(join(dir, "config.turri.yaml"), "models: [\n");
      await expect(session.work.lookAhead("app.plain")).rejects.toThrow(/Nothing was started/);
    } finally {
      await session.dispose();
      planner.mockRestore();
    }
  });
});

describe("a host turning conformance tests on", () => {
  it("writes conformance-tests: true in config.turri.yaml - every chat has conform, on or off, and no tool that turns them on - no model call", async () => {
    const turri = await createTurri({ frontend: {} });
    await turri.chats.open();
    await turri.chats.open();
    // Off, as it is unset: conform is there, refused while off; nothing for the chat to turn them on with.
    for (const chat of [0, 1]) expect(offered(chat)).toEqual({ conform: true, evaluate: false, turnOn: false });
    expect(turri.settings.turnOnConformanceTests()).toBe("config.turri.yaml");
    expect(readFileSync(join(dir, "config.turri.yaml"), "utf8")).toMatch(/^conformance-tests: true$/m);
    for (const chat of [0, 1]) expect(offered(chat)).toEqual({ conform: true, evaluate: false, turnOn: false });
    await turri.dispose();
  });

  it("writes the module's stack's file when that sets the key - which the project's alone would not change", async () => {
    writeFileSync(join(dir, "config.turri.app.yaml"), "conformance-tests: false\n");
    const turri = await createTurri({ frontend: {} });
    await turri.chats.open();
    expect(turri.settings.turnOnConformanceTests("app.plain")).toBe("config.turri.app.yaml");
    expect(readFileSync(join(dir, "config.turri.app.yaml"), "utf8")).toMatch(/^conformance-tests: true$/m);
    expect(readFileSync(join(dir, "config.turri.yaml"), "utf8")).not.toContain("conformance-tests");
    expect(offered(0)).toEqual({ conform: true, evaluate: false, turnOn: false });
    await turri.dispose();
  });
});

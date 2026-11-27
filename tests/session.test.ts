import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TurriEvent } from "../src/session.ts";

/**
 * turri's session as every front end opens it (session.ts): with none - unattended - with turri making the chats' pi
 * sessions, and with a front end making them on its own pi runtime. No model is called: a chat's pi session is a stand-in
 * that builds the extensions it is given and does nothing else.
 */

/** pi's extension API as an extension is built into it: what it registers kept, its session_start handlers run on bind. */
function piApi() {
  const started: Array<(event: unknown, ctx: unknown) => void> = [];
  const api = new Proxy({}, {
    get: (_target, key) => {
      if (key === "on") return (event: string, handler: (event: unknown, ctx: unknown) => void) => (event === "session_start" ? started.push(handler) : undefined);
      if (key === "getAllTools" || key === "getActiveTools") return () => [];
      return () => undefined;
    },
  }) as ExtensionAPI;
  return { api, started };
}

/** A pi session that does nothing: idle, with no turns, kept by its file, telling whether it was let go. */
function standInSession(started: Array<(event: unknown, ctx: unknown) => void> = [], sessionFile?: string) {
  const quiet = (): unknown => new Proxy(() => undefined, { get: (_target, key) => (key === "then" ? undefined : quiet()) });
  const context = new Proxy({ hasUI: false }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : quiet()) });
  return {
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    isBashRunning: false,
    sessionFile,
    messages: [],
    disposed: false,
    sessionManager: { getSessionName: () => undefined, getBranch: () => [] },
    getSessionStats: () => ({ cost: 0 }),
    extensionRunner: { getUIContext: () => undefined, createContext: () => ({}) },
    subscribe: () => () => {},
    bindExtensions: async () => {
      for (const handler of started) {
        try {
          handler({}, context);
        } catch {
          /* a handler that wants more of the context than this one has */
        }
      }
    },
    abort: async () => {},
    dispose() {
      this.disposed = true;
    },
  };
}

// The managed path: pi's resource loader builds every factory given into the stand-in session.
vi.mock("@earendil-works/pi-coding-agent", async (actual) => {
  const pi = await actual<typeof import("@earendil-works/pi-coding-agent")>();
  class DefaultResourceLoader {
    factories: Array<(api: unknown) => unknown>;
    constructor(options: { extensionFactories: Array<(api: unknown) => unknown> }) {
      this.factories = options.extensionFactories;
    }
    async reload() {}
  }
  return {
    ...pi,
    DefaultResourceLoader,
    SessionManager: { create: () => ({}), open: (file: string) => ({ file }) },
    createAgentSession: async ({ resourceLoader, sessionManager }: { resourceLoader: DefaultResourceLoader; sessionManager: { file?: string } }) => {
      const { api, started } = piApi();
      for (const factory of resourceLoader.factories) await factory(api);
      return { session: standInSession(started, sessionManager.file) };
    },
  };
});

const { createTurri } = await import("../src/session.ts");
const { isTurriError } = await import("../src/errors.ts");
const { readProjectConfig } = await import("../src/config.ts");
const { chainSpec } = await import("../src/regenerate/loop.ts");
const { recordHistory } = await import("../src/regenerate/lineage.ts");
const { writeCodeRecord } = await import("../src/regenerate/records.ts");
const { resolveRequiresChain } = await import("../src/regenerate/requires.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-session-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "review: true\nsentinel: false\n");
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const code = (expected: string) => (error: unknown) => isTurriError(error, expected as never);

describe("a session with no front end", () => {
  it("has no chats, and is the one session of the process until it is let go", async () => {
    const turri = await createTurri();
    try {
      await expect(turri.chats.open()).rejects.toSatisfy(code("no-chat"));
      await expect(createTurri()).rejects.toSatisfy(code("session-open"));
    } finally {
      await turri.dispose();
      await turri.dispose();
    }
    const again = await createTurri();
    await again[Symbol.asyncDispose]();
  });

  it("reads its overrides as config.turri.yaml's while it is open, and the file's once it is let go", async () => {
    const turri = await createTurri({ overrides: { codingModel: "p/code:high", review: false } });
    try {
      expect(readProjectConfig(dir)).toMatchObject({ codingModel: { model: "p/code", thinking: "high" }, review: false });
    } finally {
      await turri.dispose();
    }
    expect(readProjectConfig(dir).review).toBe(true);
  });

  it("refuses work with no module named and none in the config, as a TurriError", async () => {
    const turri = await createTurri();
    try {
      await expect(turri.work.regenerate({})).rejects.toSatisfy(code("refused"));
    } finally {
      await turri.dispose();
    }
  });
});

describe("a front end with no chats", () => {
  it("is asked turri's questions outside any chat, and opens none", async () => {
    writeFileSync(join(dir, "config.turri.yaml"), "review: false\nsentinel: true\n");
    writeFileSync(join(dir, "base.plain"), "***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# base-one\nBase one.\n");
    const app = join(dir, "app.plain");
    const appSpec = (requires: string) => `${requires}***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# app-one\nApp one.\n`;
    writeFileSync(app, appSpec(""));
    // app built before it required base: it can only be started over.
    const built = join(dir, "plain_modules", "app", "code");
    mkdirSync(built, { recursive: true });
    writeFileSync(join(built, "main.py"), "print(1)\n");
    writeCodeRecord(built, chainSpec(resolveRequiresChain(app, [], undefined, { allowNoFunctionalities: true })).tree);
    recordHistory(built, "app pulse 1 landed");
    writeFileSync(app, appSpec("---\nrequires:\n  - base\n---\n\n"));

    const asked: Array<{ title: string; chat?: string }> = [];
    const events: TurriEvent[] = [];
    const turri = await createTurri({
      frontend: { sessions: { kind: "none" }, ask: async (question, context) => (asked.push({ title: question.title, ...(context.chat !== undefined ? { chat: context.chat } : {}) }), "No") },
      onEvent: (event) => events.push(event),
    });
    try {
      await expect(turri.chats.open()).rejects.toSatisfy(code("no-chat"));
      const result = await (await turri.work.regenerate({ plainFile: app, startOver: "ask" })).done;
      expect(asked).toEqual([{ title: "Start over?" }]);
      expect(result.status).toBe("incomplete");
      expect(turri.chats.list()).toEqual([]);
      expect(events.filter((event) => event.type === "chats").flatMap((event) => event.chats)).toEqual([]);
    } finally {
      await turri.dispose();
    }
  });
});

describe("a session's events", () => {
  it("are heard by type or all, stop with their signal, and a listener's throw reaches no one else", async () => {
    const warned = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const turri = await createTurri({ frontend: {} });
    try {
      const all: string[] = [];
      const counts: number[] = [];
      const controller = new AbortController();
      turri.on(() => {
        throw new Error("a front end's mistake");
      });
      turri.on((event) => all.push(event.type));
      turri.on("chats", (event) => counts.push(event.chats.length), { signal: controller.signal });
      await turri.chats.open();
      controller.abort();
      await turri.chats.open();
      expect(counts.at(-1)).toBe(1);
      expect(all.filter((type) => type === "chats").length).toBeGreaterThan(counts.length);
      expect(warned).toHaveBeenCalledWith(expect.objectContaining({ message: "a front end's mistake" }), { code: "TURRI_LISTENER" });
    } finally {
      await turri.dispose();
      warned.mockRestore();
    }
  });

  it("are plain data, safe to send to another process, and stream until the session is let go", async () => {
    const turri = await createTurri({ frontend: {} });
    const streamed: TurriEvent[] = [];
    const reading = (async () => {
      for await (const event of turri.events()) streamed.push(event);
    })();
    await turri.chats.open();
    await turri.dispose();
    await reading;
    expect(streamed.length).toBeGreaterThan(0);
    for (const event of streamed) expect(structuredClone(event)).toEqual(event);
  });
});

describe("a front end's chats, on sessions turri makes", () => {
  it("are built with turri's extension and the front end's, and focused unless asked not to be", async () => {
    const built: string[] = [];
    const turri = await createTurri({ frontend: { extensions: [() => void built.push("front end")] } });
    try {
      const chat = await turri.chats.open();
      expect(built).toEqual(["front end"]);
      expect(turri.chats.focused()).toBe(chat.id);
      await turri.chats.open({ focus: false });
      expect(turri.chats.focused()).toBe(chat.id);
      expect(turri.chats.list()).toHaveLength(2);
    } finally {
      await turri.dispose();
    }
  });

  it("stop what they do without ending the session, decline nothing when nothing is asked, and throw once closed", async () => {
    const turri = await createTurri({ frontend: {} });
    try {
      const chat = await turri.chats.open();
      expect(await chat.stop()).toBe("idle");
      expect(await chat.decline()).toBe("none");
      expect(turri.chats.list()).toHaveLength(1);
      await turri.chats.close(chat.id);
      expect(() => chat.session).toThrowError(expect.objectContaining({ code: "chat-closed" }));
      await expect(chat.stop()).rejects.toSatisfy(code("chat-closed"));
      expect(turri.chats.get(chat.id)).toBeUndefined();
    } finally {
      await turri.dispose();
    }
  });

  it("are reopened from a run, but for those open already", async () => {
    const turri = await createTurri({ frontend: {} });
    try {
      await turri.chats.open({ sessionFile: join(dir, "a.jsonl") });
      writeFileSync(join(dir, "a.jsonl"), "");
      writeFileSync(join(dir, "b.jsonl"), "");
      const reopened = await turri.chats.restore({
        run: "earlier",
        pid: 1,
        started: new Date().toISOString(),
        chats: [
          { id: "a", title: "first", sessionFile: join(dir, "a.jsonl") },
          { id: "b", title: "second", sessionFile: join(dir, "b.jsonl") },
        ],
      });
      expect(reopened).toHaveLength(1);
      expect(turri.chats.list()).toHaveLength(2);
    } finally {
      await turri.dispose();
    }
  });
});

describe("a front end's chats, on sessions it makes itself", () => {
  it("are made by the front end with turri's extension in them, refused without it, and released by it", async () => {
    const released: string[] = [];
    let build = true;
    let turri: Awaited<ReturnType<typeof createTurri>> | undefined;
    turri = await createTurri({
      frontend: {
        sessions: {
          kind: "external",
          async create() {
            const { api, started } = piApi();
            if (build) await turri!.extension(api);
            return standInSession(started) as unknown as AgentSession;
          },
          async release(chat) {
            released.push(chat);
          },
        },
      },
    });
    try {
      const chat = await turri.chats.open();
      expect(turri.chats.list()).toHaveLength(1);
      build = false;
      await expect(turri.chats.open()).rejects.toSatisfy(code("extension-not-built"));
      await turri.chats.close(chat.id);
      expect(released).toEqual([chat.id]);
    } finally {
      await turri.dispose();
    }
  });

  it("adopts a pi session the front end made with turri's extension, as a chat", async () => {
    const turri = await createTurri({ frontend: { sessions: { kind: "external", create: async () => { throw new Error("not this way"); } } } });
    try {
      const { api } = piApi();
      await turri.extension(api);
      const session = standInSession() as unknown as AgentSession;
      const chat = turri.chats.adopt(session);
      expect(turri.chats.get(chat.id)?.session).toBe(session);
      expect(turri.chats.list().map((info) => info.id)).toEqual([chat.id]);
    } finally {
      await turri.dispose();
    }
  });
});

describe("a session's settings", () => {
  it("are written as /settings writes them and read back, a bad value or an unknown key refused", async () => {
    const turri = await createTurri();
    try {
      const { file, said } = await turri.settings.set("review", false);
      expect(file).toBe("config.turri.yaml");
      expect(said).toContain("review: false");
      expect(turri.settings.get("review")).toBe(false);
      expect(readFileSync(join(dir, "config.turri.yaml"), "utf8")).toContain("review: false");
      await expect(turri.settings.set("review", "maybe" as never)).rejects.toSatisfy(code("refused"));
      await expect(turri.settings.set("no-such-key" as never, 1 as never)).rejects.toSatisfy(code("not-found"));
    } finally {
      await turri.dispose();
    }
  });

  it("are read and written by their type - a number, a list, a model, a choice", async () => {
    const turri = await createTurri();
    try {
      await turri.settings.set("max-specs-per-pulse", 4);
      await turri.settings.set("agent-env.vars", ["HOME", "PATH"]);
      await turri.settings.set("models.coding", "anthropic/claude-opus-5-5:low");
      await turri.settings.set("sentinel", false);
      expect(turri.settings.get("max-specs-per-pulse")).toBe(4);
      expect(turri.settings.get("agent-env.vars")).toEqual(["HOME", "PATH"]);
      expect(turri.settings.get("models.coding")).toBe("anthropic/claude-opus-5-5:low");
      expect(turri.settings.get("sentinel")).toBe(false);
      await turri.settings.set("max-specs-per-pulse", undefined);
      expect(turri.settings.get("max-specs-per-pulse")).toBeUndefined();
    } finally {
      await turri.dispose();
    }
  });

  it("refuse what /settings refuses - a number below its least, a path outside the project, a project setting in a module's file", async () => {
    const turri = await createTurri();
    try {
      await expect(turri.settings.set("max-specs-per-pulse", 0)).rejects.toSatisfy(code("refused"));
      await expect(turri.settings.set("test-dir", "../elsewhere")).rejects.toSatisfy(code("refused"));
      await expect(turri.settings.set("parallel-jobs", 2, { module: "backend" })).rejects.toSatisfy(code("refused"));
      await expect(turri.settings.set("rules-off", ["no-such-rule"])).rejects.toSatisfy(code("refused"));
    } finally {
      await turri.dispose();
    }
  });

  it("say a value the file has that its kind cannot take, naming the file", async () => {
    writeFileSync(join(dir, "config.turri.yaml"), "review: maybe\n");
    const turri = await createTurri();
    try {
      expect(() => turri.settings.get("review")).toThrow(/config\.turri\.yaml's review is maybe: it takes true or false/);
      expect(() => turri.settings.get("review")).toSatisfy((read: () => unknown) => { try { read(); return false; } catch (error) { return isTurriError(error, "config-invalid"); } });
    } finally {
      await turri.dispose();
    }
  });

  it("give the model the session was opened with way to the file's, as /settings does", async () => {
    const turri = await createTurri({ overrides: { codingModel: "openai/gpt-6-luna" } });
    try {
      const { said } = await turri.settings.set("coding-model", "anthropic/claude-opus-5-5");
      expect(said).toContain("given way to the config: the coding model this session was opened with, openai/gpt-6-luna");
    } finally {
      await turri.dispose();
    }
  });
});

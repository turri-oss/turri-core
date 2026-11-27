import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../src/session-events.ts";

/** A tool turri registered in a chat, run as pi runs it: id, arguments, the turn's signal, updates, the context. */
type Tool = { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> };

/** What each chat's session was asked to do, and the tools turri registered in it, by the order the chats were made in. */
const sessions: Array<{ isStreaming: boolean; did: string[]; tools: Map<string, Tool> }> = [];

// A host's chats on pi sessions that run nothing: each says whether a turn is running, and records what stops it. The
// extensions are built into each, keeping the tools they register.
vi.mock("@earendil-works/pi-coding-agent", async (actual) => {
  const pi = await actual<typeof import("@earendil-works/pi-coding-agent")>();
  class DefaultResourceLoader {
    factories: Array<(api: unknown) => void>;
    constructor(options: { extensionFactories: Array<(api: unknown) => void> }) {
      this.factories = options.extensionFactories;
    }
    async reload() {}
  }
  return {
    ...pi,
    DefaultResourceLoader,
    SessionManager: { create: () => ({}), open: () => ({}) },
    createAgentSession: async ({ resourceLoader }: { resourceLoader: DefaultResourceLoader }) => {
      const state = { isStreaming: false, did: [] as string[], tools: new Map<string, Tool>() };
      sessions.push(state);
      const api = new Proxy({}, { get: (_target, key) => (key === "registerTool" ? (tool: Tool & { name: string }) => state.tools.set(tool.name, tool) : () => undefined) });
      for (const factory of resourceLoader.factories) factory(api);
      const session = {
        get isStreaming() {
          return state.isStreaming;
        },
        isCompacting: false,
        isRetrying: false,
        isBashRunning: false,
        sessionFile: undefined,
        messages: [],
        sessionManager: { getSessionName: () => undefined },
        getSessionStats: () => ({ cost: 0 }),
        extensionRunner: { getUIContext: () => undefined },
        subscribe: () => () => {},
        bindExtensions: async () => {},
        abort: async () => {
          state.did.push("abort");
          state.isStreaming = false;
        },
        abortBash: () => state.did.push("abortBash"),
        dispose: () => state.did.push("dispose"),
      };
      return { session };
    },
  };
});

const { createTurri } = await import("../src/session.ts");
const { DECLINED } = await import("../src/ask.ts");

/** The sessions a test opened: let go after it, as one session a process is all there can be. */
const opened: Array<{ dispose(): Promise<void> }> = [];
const keep = <T extends { dispose(): Promise<void> }>(session: T): T => (opened.push(session), session);
afterEach(async () => {
  for (const session of opened.splice(0)) await session.dispose();
});

it("reports the startup sweep and agent costs before a chat opens and stops reporting on disposal", async () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "turri-host-events-"));
  const sweep = vi.spyOn(await import("../src/regenerate/shell.ts"), "sweepOrphanedGroups").mockReturnValue(3);
  const { reportModelEvent } = await import("../src/regenerate/activity.ts");
  const events: SessionEvent[] = [];
  process.chdir(dir);
  try {
    const session = await createTurri({ onEvent: (event) => events.push(event as never) });
    try {
      expect(events).toContainEqual({ type: "orphansStopped", count: 3 });
      // Each heard once, by its own event: never again as a notification.
      expect(events.some((event) => event.type === "notification")).toBe(false);
      expect(sweep).toHaveBeenCalledTimes(1);
      reportModelEvent({ kind: "provider_stall", role: "planner" });
      expect(events.at(-1)).toMatchObject({ type: "incident", event: { kind: "provider_stall" } });
      expect(events.some((event) => event.type === "notification")).toBe(false);
      const call = { kind: "call", role: "planner", usage: { cost: 0.5, input: 5, output: 2, cacheRead: 0, cacheWrite: 0 } } as const;
      reportModelEvent(call);
      reportModelEvent(call);
      expect(events.at(-1)).toMatchObject({ type: "spending", spending: { other: [{ role: "planner", cost: 1 }] } });
      expect(session.spending().other).toEqual([{ role: "planner", cost: 1 }]);
    } finally {
      await session.dispose();
    }
    const count = events.length;
    reportModelEvent({ kind: "provider_stall" });
    expect(events).toHaveLength(count);
  } finally {
    sweep.mockRestore();
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
type AskUserIO = import("../src/ask.ts").AskUserIO;

/** A host's dialogs that never answer, keeping each question they were given and the signal it came with. */
function silentDialogs() {
  const shown: Array<{ title: string; signal: AbortSignal | undefined }> = [];
  const dialogs: AskUserIO = {
    select: (title, _options, _context, _at, asked) => {
      shown.push({ title, signal: asked?.signal });
      return new Promise(() => {});
    },
    input: (title, _context, asked) => {
      shown.push({ title, signal: asked?.signal });
      return new Promise(() => {});
    },
  };
  return { dialogs, shown };
}

/** The chat's ask_user, called as its agent calls it in a turn stopped by `turn`. */
function askUser(chat: number, question: string, turn = new AbortController()): Promise<string> {
  const tool = sessions[chat]!.tools.get("ask_user")!;
  return tool.execute("call", { question, options: ["Yes", "No"] }, turn.signal, undefined, { hasUI: false, signal: turn.signal }).then((result) => result.content[0]!.text);
}

/** A front end asking through those dialogs. */
const asking = (dialogs: AskUserIO) => ({
  frontend: {
    ask: (question: import("../src/session.ts").Question, { signal }: { signal: AbortSignal }) =>
      question.kind === "select" ? dialogs.select(question.title, question.options, question.context, question.at, { signal }) : dialogs.input(question.title, question.context, { signal }),
  },
});

/** Once the host's dialogs have shown `count` questions. */
async function shownCount(shown: unknown[], count: number): Promise<void> {
  while (shown.length < count) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a host interrupting a chat", () => {
  const cwd = process.cwd();
  beforeEach(() => {
    sessions.length = 0;
    process.chdir(mkdtempSync(join(tmpdir(), "turri-interrupt-")));
  });
  afterEach(() => process.chdir(cwd));

  it("stops the turn of that chat alone, says when it was doing nothing, and never ends the session", async () => {
    const turri = keep(await createTurri({ frontend: {} }));
    const first = await turri.chats.open();
    await turri.chats.open();
    const [one, two] = sessions;
    one!.isStreaming = true;
    two!.isStreaming = true;

    expect(await first.stop()).toBe("stopped");
    expect(one!.did).toEqual(["abort"]);
    expect(two!.did).toEqual([]);

    one!.isStreaming = false;
    expect(await first.stop()).toBe("idle");
    expect(turri.chats.list()).toHaveLength(2);
    expect(two!.did).not.toContain("dispose");
    await turri.dispose();
  });
});

describe("a host declining a chat's question", () => {
  const cwd = process.cwd();
  beforeEach(() => {
    sessions.length = 0;
    process.chdir(mkdtempSync(join(tmpdir(), "turri-decline-")));
  });
  afterEach(() => process.chdir(cwd));

  it("answers the question DECLINED and lets the turn go on", async () => {
    const { dialogs, shown } = silentDialogs();
    const turri = keep(await createTurri(asking(dialogs)));
    const chat = await turri.chats.open();
    sessions[0]!.isStreaming = true;

    const answer = askUser(0, "Ship it?");
    await shownCount(shown, 1);
    expect(await chat.decline()).toBe("declined");
    expect(await answer).toContain(DECLINED);
    expect(sessions[0]!.did).toEqual([]);
    expect(sessions[0]!.isStreaming).toBe(true);
  });

  it("declines each question it is called at, five in a row, the turn still running", async () => {
    const { dialogs, shown } = silentDialogs();
    const turri = keep(await createTurri(asking(dialogs)));
    const chat = await turri.chats.open();
    sessions[0]!.isStreaming = true;

    const questions = ["Which stack?", "Which database?", "Which host?", "Which auth?", "Which CI?"];
    for (const [at, question] of questions.entries()) {
      const answer = askUser(0, question);
      await shownCount(shown, at + 1);
      expect(await chat.decline()).toBe("declined");
      expect(await answer).toContain(DECLINED);
    }
    expect(shown.map((dialog) => dialog.title)).toEqual(questions);
    expect(sessions[0]!.did).toEqual([]);
    expect(sessions[0]!.isStreaming).toBe(true);
  });

  it("declines nothing in a chat asking nothing, nor in another chat", async () => {
    const { dialogs, shown } = silentDialogs();
    const turri = keep(await createTurri(asking(dialogs)));
    const first = await turri.chats.open();
    const second = await turri.chats.open();
    expect(await first.decline()).toBe("none");

    const answer = askUser(1, "Ship it?");
    await shownCount(shown, 1);
    expect(await first.decline()).toBe("none");
    expect(shown[0]!.signal?.aborted).toBe(false);
    expect(await second.decline()).toBe("declined");
    expect(await answer).toContain(DECLINED);
    expect(await second.decline()).toBe("none");
  });

  it("has no handle for a chat that is not open", async () => {
    const turri = keep(await createTurri({ frontend: {} }));
    expect(turri.chats.get("nochat")).toBeUndefined();
    await turri.dispose();
  });

  it("aborts the signal of the host's dialog when its question is declined", async () => {
    const { dialogs, shown } = silentDialogs();
    const turri = keep(await createTurri(asking(dialogs)));
    const chat = await turri.chats.open();

    const answer = askUser(0, "Ship it?");
    await shownCount(shown, 1);
    expect(shown[0]!.signal?.aborted).toBe(false);
    await chat.decline();
    expect(shown[0]!.signal?.aborted).toBe(true);
    await answer;
  });

  it("aborts the signal of the host's dialog when the turn that asked is stopped", async () => {
    const { dialogs, shown } = silentDialogs();
    const turri = keep(await createTurri(asking(dialogs)));
    const chat = await turri.chats.open();

    const turn = new AbortController();
    const answer = askUser(0, "Ship it?", turn);
    await shownCount(shown, 1);
    turn.abort();
    expect(shown[0]!.signal?.aborted).toBe(true);
    expect(await answer).toContain(DECLINED);
    expect(await chat.decline()).toBe("none");
  });
});

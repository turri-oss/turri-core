import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskUser, AskUserIO } from "../src/ask.ts";
import type { CaptureStatus } from "../src/capture/progress.ts";
import type { TurriCore, TurriHost } from "../src/chats.ts";
import type { SessionEvent, SkillProgress } from "../src/session-events.ts";
import type { Job } from "../src/regenerate/jobs.ts";

/**
 * The seams a front-end draws through (view.ts): each hook called where the terminal's drawing was, with what it read -
 * and turri behaving as it always has for a session with no view.
 */

// No test calls a model: a pulse that fails for good is diagnosed by an agent on the coding model - here, by none.
vi.mock("../src/regenerate/diagnose.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/regenerate/diagnose.ts")>()),
  diagnoseFailure: async () => undefined,
}));

/** What /capture runs, scripted: one status watched, then its end. */
const watched: CaptureStatus = { root: "codebase", started: 10, stage: "surveying", features: { outlined: 0, done: 0 }, outlining: 0, work: { done: 0, total: 1 }, agents: [], cost: 0 };
vi.mock("../src/capture/capture.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/capture/capture.ts")>()),
  runCapture: vi.fn(async (options: { root: string; watch?: (status: CaptureStatus) => void }) => {
    options.watch?.(watched);
    return { plainDir: join(options.root, "plain"), reportFile: join(options.root, "plain", "report.md"), summary: "1 module.", modules: ["app"], specs: 1, uncaptured: 0, failing: 0 };
  }),
}));

/** What cultivate runs, scripted: a skill whose interview asks one question, its answer its artifact. */
vi.mock("../src/genome.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/genome.ts")>()),
  runSkill: vi.fn(async (options: { askUser: AskUser }) => ({ ok: true, artifacts: {}, output: await options.askUser({ question: "Which stack?", options: ["Flask", "Django"] }) })),
}));

const { askUserVia, chatAskUserTool, createTurriCore } = await import("../src/extension.ts");
const { currentChat } = await import("../src/chat-scope.ts");
const { DECLINED } = await import("../src/ask.ts");

let project: string;
let before: string;
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "turri-view-")));
  writeFileSync(join(project, "config.turri.yaml"), "conformance-tests: false\n");
  before = process.cwd();
  process.chdir(project);
});
afterEach(() => {
  process.chdir(before);
  rmSync(project, { recursive: true, force: true });
});

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler: (args: string, ctx: unknown) => Promise<unknown> };
type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> };

/** pi as a chat's extension is built into it: what is registered and appended kept, in order, and nothing else done. */
function recordingPi(own: Record<string, unknown> = {}) {
  const order: string[] = [];
  const entries: Array<{ type: string; data: unknown }> = [];
  const commands = new Map<string, Command>();
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, Handler[]>();
  const pi = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "registerCommand")
          return (name: string, command: Command) => {
            order.push(`/${name}`);
            commands.set(name, command);
          };
        if (key === "registerTool") return (tool: Tool) => void tools.set(tool.name, tool);
        if (key === "on") return (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        if (key === "appendEntry") return (type: string, data: unknown) => (order.push(`entry ${type}`), entries.push({ type, data }));
        if (typeof key === "string" && Object.hasOwn(own, key)) return own[key];
        return () => undefined;
      },
    },
  ) as never;
  /** The chat's session started, its handlers run in order as pi runs them. */
  const start = async (ctx: unknown) => {
    for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
  };
  return { pi, order, entries, commands, tools, handlers, start };
}

/** A session whose chats are opened by a driver of the test's: each built into a pi of its own, kept in `pis`. */
function withChats(host: TurriHost = {}, options: Parameters<typeof createTurriCore>[1] = {}) {
  const session = createTurriCore(host, options);
  const pis: Array<ReturnType<typeof recordingPi>> = [];
  session.setDriver({
    create: async () => {
      const made = recordingPi();
      pis.push(made);
      await session.extension(made.pi);
    },
    dispose: async () => {},
  });
  return { session, pis };
}

/** A chat's context, as pi hands it to the extension's handlers. */
const contextOf = (hasUI: boolean, ui: Record<string, unknown> = {}) => ({ hasUI, cwd: project, model: undefined, sessionManager: { getBranch: () => [], getEntries: () => [] }, ui: { notify: () => {}, setWorkingMessage: () => {}, ...ui } });

const settled = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("the banner of each chat", () => {
  it("names in the banner who runs turri - the front end as it said it, else the core", async () => {
    const { coreIdentity } = await import("../src/environment.ts");
    for (const client of [undefined, { name: "turri", version: "9.9.9", commit: "abcdef1234", changed: true }]) {
      const session = createTurriCore({}, client !== undefined ? { client } : {});
      const { pi, start, entries } = recordingPi();
      try {
        await session.extension(pi);
        await start(contextOf(false));
        const banner = entries.find((entry) => entry.type === "turri_banner")?.data;
        expect(banner).toMatchObject(client !== undefined ? { name: "turri", version: "9.9.9", commit: "abcdef1", changed: true } : { name: "@turri-dev/core", version: coreIdentity().version });
        expect(banner).not.toHaveProperty("versions");
      } finally { await session.dispose(); }
    }
  });
  it("is appended once a chat, however often the chat starts again", async () => {
    const { session, pis } = withChats();
    await session.open({ hidden: true });
    await pis[0]!.start(contextOf(false));
    await pis[0]!.start(contextOf(false));
    expect(pis[0]!.order.filter((step) => step === "entry turri_banner")).toHaveLength(1);
  });
});

describe("what the model reads of a chat", () => {
  it("reads each of turri's own messages inside a note, and the person's next message beside it as theirs", async () => {
    const { session, pis } = withChats();
    try {
      await session.open({ hidden: true });
      // A conclusion told with no turn of its own, then the person's next message: one turn as the model reads it.
      const concluded = { role: "custom", customType: "turri_sentinel_concluded", content: "The sentinel is done with tidy pulse 1: it holds.", display: false, timestamp: 1 };
      const person = { role: "user", content: [{ type: "text", text: ".json goes under documents, not code." }], timestamp: 2 };
      const theirs = { role: "custom", customType: "another_extension", content: "Not turri's.", display: false, timestamp: 3 };
      const parts = { role: "custom", customType: "turri_job_landed", content: [{ type: "text", text: "Pulse 1 landed." }], display: false, timestamp: 4 };
      const [handler] = pis[0]!.handlers.get("context") ?? [];
      const { messages } = (await handler!({ type: "context", messages: [concluded, person, theirs, parts] }, contextOf(false))) as { messages: unknown[] };
      expect(messages).toEqual([
        { ...concluded, content: "<turri-note>\nThe sentinel is done with tidy pulse 1: it holds.\n</turri-note>" },
        person,
        theirs,
        { ...parts, content: [{ type: "text", text: "<turri-note>" }, { type: "text", text: "Pulse 1 landed." }, { type: "text", text: "</turri-note>" }] },
      ]);
      // As it was sent, in the transcript.
      expect(concluded.content).toBe("The sentinel is done with tidy pulse 1: it holds.");
    } finally {
      await session.dispose();
    }
  });
});

describe("/pulses", () => {
  it("asks the front end to show the pulses, and lists them in the chat when it shows none", async () => {
    const revealed: Array<[unknown, unknown]> = [];
    for (const reveal of [(target: unknown, context: unknown) => (revealed.push([target, context]), true), undefined]) {
      const { session, pis } = withChats(reveal !== undefined ? { reveal } : {});
      try {
        await session.open({ hidden: true });
        await pis[0]!.commands.get("pulses")!.handler("", contextOf(true));
        expect(pis[0]!.order.filter((step) => step === "entry turri_command_outcome").length).toBe(reveal !== undefined ? 0 : 1);
      } finally {
        await session.dispose();
      }
    }
    expect(revealed).toEqual([[{ kind: "pulses" }, { chat: expect.any(String) }]]);
  });
});

describe("a capture's progress", () => {
  it("gives a front end snapshots and one outcome in the chat that started it", async () => {
    const events: Extract<SessionEvent, { type: "captureProgress" | "captureEnded" }>[] = [];
    const { session, pis } = withChats({ onEvent(event) {
      if (event.type === "captureProgress" || event.type === "captureEnded") events.push(event);
    } });
    try {
      await session.open();
      const second = await session.open({ hidden: true });
      const run = vi.mocked((await import("../src/capture/capture.ts")).runCapture);
      run.mockImplementationOnce(async ({ root, watch }) => {
        const status = structuredClone({ ...watched, root });
        watch?.(status);
        status.work.done++;
        watch?.(status);
        return { plainDir: join(root, "plain"), reportFile: join(root, "plain", "report.md"), summary: "1 module.", modules: ["app"], specs: 1, uncaptured: 0, failing: 0 };
      });
      const command = pis[1]!.commands.get("capture")!;
      await command.handler("", contextOf(false));
      await vi.waitFor(() => expect(events).toHaveLength(3));
      expect(events).toMatchObject([
        { type: "captureProgress", chat: second.id, status: { work: { done: 0 } } },
        { type: "captureProgress", chat: second.id, status: { work: { done: 1 } } },
        { type: "captureEnded", chat: second.id, root: project, state: "completed", result: { plainDir: join(project, "plain") } },
      ]);
      run.mockRejectedValueOnce(new Error("writer failed"));
      await command.handler("", contextOf(false));
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: "captureEnded", chat: second.id, root: project, state: "failed", error: "writer failed" }));
      run.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("interrupted")), { once: true })));
      await command.handler("", contextOf(false));
      for (const handler of pis[1]!.handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, contextOf(false));
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: "captureEnded", chat: second.id, root: project, state: "stopped" }));
    } finally {
      await session.dispose();
    }
  });

  it("runs on the project's models, not the chat's, and hands the captured project to the front end to open", async () => {
    const opened: Array<[string, { summary: string; reportFile: string }]> = [];
    const session = createTurriCore({}, { openProject: async (dir, context) => (opened.push([dir, context]), true) });
    const { pi, commands } = recordingPi();
    session.setDriver({ create: async () => void (await session.extension(pi)), dispose: async () => {} });
    try {
      await session.open();
      const run = vi.mocked((await import("../src/capture/capture.ts")).runCapture);
      run.mockClear();
      // The chat on pi's fallback model: none of it reaches the capture.
      const ctx = { ...contextOf(true), model: { provider: "anthropic", id: "claude-fallback" } };
      await commands.get("capture")!.handler("", ctx);
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      const options = run.mock.calls[0]![0];
      expect(options).toMatchObject({ root: project, configFrom: project });
      expect(options).not.toHaveProperty("model");
      expect(options).not.toHaveProperty("harnessModel");
      expect(opened[0]).toEqual([join(project, "plain"), { summary: "1 module.", reportFile: join(project, "plain", "report.md") }]);
    } finally {
      await session.dispose();
    }
  });

  it("tells the capture's report once, in the first chat of a session opened in the captured project", async () => {
    const session = createTurriCore({}, { captured: { summary: "Captured 2 functional specs." } });
    const made: Array<ReturnType<typeof recordingPi>> = [];
    // Each chat on an idle pi session, so what is told to it is delivered.
    session.setDriver({ create: async (state) => { state.session = { isStreaming: false, isCompacting: false, isRetrying: false, getSessionStats: () => ({ cost: 0 }), subscribe: () => () => {} } as never; const chat = recordingPi(); made.push(chat); await session.extension(chat.pi); }, dispose: async () => {} });
    try {
      await session.open();
      await session.open({ hidden: true });
      for (const chat of made) await chat.start(contextOf(false));
      const told = () => made.map((chat) => chat.order.filter((line) => line === "entry turri_skill_run").length);
      await vi.waitFor(() => expect(told()).toEqual([1, 0]));
      await settled();
      expect(told()).toEqual([1, 0]);
    } finally {
      await session.dispose();
    }
  });
});

it("reports a foreground skill's phases and retry in its own chat and clears its progress on failure", async () => {
  const dir = join(project, ".turri", "skills", "probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: probe\ndescription: Check.\nmetadata:\n  phases:\n    stack: chooses\n    product: writes\n---\n\n## Steps\n\n### stack\n\nChoose.\n\n### product\n\nWrite.\n");
  vi.mocked((await import("../src/genome.ts")).runSkill).mockImplementationOnce(async ({ report }) => {
    report.step("stack", 1);
    report.step("stack", 2);
    throw new Error("interrupted test run");
  });
  const events: SessionEvent[] = [];
  const session = createTurriCore({ onEvent: (e) => events.push(e) });
  const { pi, tools } = recordingPi();
  await session.extension(pi);
  try {
    await expect(tools.get("cultivate")!.execute("id", { skill: "probe" }, undefined, undefined, contextOf(true))).rejects.toThrow("interrupted test run");
    const progress: Array<SkillProgress | null> = [
      { skill: "probe", phases: ["stack", "product"], current: -1, attempt: 1 },
      { skill: "probe", phases: ["stack", "product"], current: 0, attempt: 1, about: "chooses" },
      { skill: "probe", phases: ["stack", "product"], current: 0, attempt: 2, about: "chooses" }, null,
    ];
    expect(events.filter((e) => e.type === "skillProgress")).toEqual(progress.map((step) => ({ type: "skillProgress", chat: session.chats()[0]!.id, progress: step })));
  } finally {
    await session.dispose();
  }
});

describe("pi's own settings, last in /settings", () => {
  const pickPi = (notified: string[]) =>
    contextOf(true, { select: async (_title: string, lines: string[]) => lines[lines.length - 1], notify: (message: string) => void notified.push(message) });

  it("open where the front end has them", async () => {
    const opened: string[] = [];
    const notified: string[] = [];
    const { session, pis } = withChats({ openPiSettings: () => opened.push("pi") > 0 });
    await session.open({ hidden: true });
    await pis[0]!.commands.get("settings")!.handler("", pickPi(notified));
    expect(opened).toEqual(["pi"]);
    expect(notified).toEqual([]);
  });

  it("are said to open only where the front end has them, in one that has none", async () => {
    const notified: string[] = [];
    const { session, pis } = withChats();
    await session.open({ hidden: true });
    await pis[0]!.commands.get("settings")!.handler("", pickPi(notified));
    expect(notified).toEqual(["pi's own settings open only where the app you use has them."]);
  });
});

describe("a question in a chat with a screen", () => {
  it("is put in pi's own dialogs with no front end's - what to read above the question", async () => {
    const asked: Array<{ title: string; options: string[] }> = [];
    const ctx = contextOf(true, {
      select: async (title: string, options: string[]) => {
        asked.push({ title, options });
        return options[1];
      },
    });
    const kept: string[] = [];
    const answer = await askUserVia(ctx as never, (question, answered) => kept.push(`${question} ${answered}`))({
      question: "Which CRM first?",
      options: ["HubSpot", "Salesforce"],
      context: "Both have an API.",
    });
    expect(answer).toBe("Salesforce");
    expect(asked[0]!.title).toBe("Both have an API.\n\nWhich CRM first?");
    expect(asked[0]!.options).toEqual(expect.arrayContaining(["HubSpot", "Salesforce"]));
    expect(kept).toEqual(["Which CRM first? Salesforce"]);
  });

  it("closes pi's dialog when the turn that asked it stops, and comes back declined", async () => {
    const turn = new AbortController();
    let dialog: AbortSignal | undefined;
    const ctx = {
      ...contextOf(true, {
        select: (_title: string, _options: string[], opts: { signal: AbortSignal }) => {
          dialog = opts.signal;
          return new Promise(() => {});
        },
      }),
      signal: turn.signal,
    };
    const asked = askUserVia(ctx as never, () => {})({ question: "Ship it?", options: ["Yes"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog?.aborted).toBe(false);
    turn.abort();
    expect(await asked).toBe(DECLINED);
    expect(dialog?.aborted).toBe(true);
  });

  it("is put in the front end's dialogs over pi's", async () => {
    const events: string[] = [];
    const dialogs: AskUserIO = {
      select: async (title, options) => {
        events.push(`front end asked ${title}`);
        return options[1];
      },
      input: async () => undefined,
    };
    const ctx = contextOf(true, { select: async () => void events.push("pi's select"), setWorkingMessage: () => void events.push("working message") });
    const answer = await askUserVia(ctx as never, () => {}, undefined, dialogs)({ question: "Ship it?", options: ["Yes", "Not yet"] });
    expect(answer).toBe("Not yet");
    expect(events).toEqual(["front end asked Ship it?"]);
  });

  /** A chat's context with a screen whose own dialogs say so when they are opened. */
  const withPiDialogs = (events: string[]) =>
    contextOf(true, {
      select: async () => void events.push("pi's select"),
      input: async () => void events.push("pi's input"),
      setWidget: () => {},
    });

  /** A front end's dialogs for each chat, saying what they were asked and answering with the second option. */
  const frontEndDialogs = (events: string[]) => ({
    dialogs: (chat: string): AskUserIO => ({
      select: async (title, options) => (events.push(`${chat === "" ? "?" : "front end"} asked ${title}`), options[1]),
      input: async () => undefined,
    }),
  });

  it("is put in the front end's dialogs from the ask_user of a session's chat, never in pi's", async () => {
    const events: string[] = [];
    const { session, pis } = withChats({}, frontEndDialogs(events));
    await session.open({ hidden: true });
    const result = await pis[0]!.tools.get("ask_user")!.execute("id", { question: "Ship it?", options: ["Yes", "Not yet"] }, undefined, undefined, withPiDialogs(events));
    expect(result.content[0]!.text).toContain("Not yet");
    expect(events).toEqual(["front end asked Ship it?"]);
  });

  it("is put in the front end's dialogs from a skill's interview in a session's chat, never in pi's", async () => {
    const events: string[] = [];
    const { session, pis } = withChats({}, frontEndDialogs(events));
    await session.open({ hidden: true });
    const result = await pis[0]!.tools.get("cultivate")!.execute("id", { skill: "debug-specs", context: "The specs disagree." }, undefined, undefined, withPiDialogs(events));
    expect(result.content[0]!.text).toContain("<artifact>\nDjango\n</artifact>");
    expect(events).toEqual(["front end asked Which stack?"]);
  });
});

describe("a person's chat and harness-model", () => {
  const model = (provider: string, id: string) => ({ provider, id });
  /** A chat of the person's on a pi whose models are `models`, signed in to `signedIn`: what it was put on, kept. */
  async function chatOn(models: Array<{ provider: string; id: string }>, signedIn: Set<string>) {
    const events: SessionEvent[] = [];
    const session = createTurriCore({ onEvent: (event) => events.push(event) });
    const put: string[] = [];
    let on: { provider: string; id: string } | undefined = model("amazon-bedrock", "us.anthropic.claude-sonnet");
    const made = recordingPi({
      setModel: async (chosen: { provider: string; id: string }) => (put.push(`${chosen.provider}/${chosen.id}`), (on = chosen), true),
      setThinkingLevel: (level: string) => void put.push(`:${level}`),
    });
    session.setDriver({ create: async () => void (await session.extension(made.pi)), dispose: async () => {} });
    await session.open({ hidden: true });
    const ctx = () => ({
      ...contextOf(false),
      model: on,
      modelRegistry: {
        find: (provider: string, id: string) => models.find((each) => each.provider === provider && each.id === id),
        hasConfiguredAuth: (found: { provider: string }) => signedIn.has(found.provider),
      },
    });
    /** Something sent to the chat: whether it went on to the model. */
    const send = async (text: string) => {
      for (const handler of made.handlers.get("input") ?? []) {
        const result = (await handler({ type: "input", text, source: "interactive" }, ctx())) as { action: string } | undefined;
        if (result?.action === "handled") return false;
      }
      return true;
    };
    return { session, events, put, send, start: () => made.start(ctx()), choose: (chosen: { provider: string; id: string }) => void (on = chosen) };
  }

  it("is put on harness-model as it starts, with its thinking", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: openai/gpt-6-astra:high\n");
    const { session, put, start } = await chatOn([model("openai", "gpt-6-astra")], new Set(["openai"]));
    try {
      await start();
      expect(put).toEqual(["openai/gpt-6-astra", ":high"]);
    } finally {
      await session.dispose();
    }
  });

  it("sends nothing to a model while harness-model's provider is not signed in - said, and heard - until it is", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: openai/gpt-6-astra\n");
    const signedIn = new Set<string>();
    const { session, events, put, send, start } = await chatOn([model("openai", "gpt-6-astra")], signedIn);
    try {
      await start();
      expect(put).toEqual([]);
      expect(await send("build the todo app")).toBe(false);
      const chat = session.chats()[0]!.id;
      expect(events).toContainEqual({ type: "outOfReach", chat, outOfReach: { model: "openai/gpt-6-astra", provider: "openai", why: "signed-out" } });
      expect(events).toContainEqual(expect.objectContaining({ type: "notification", chat, level: "error", text: expect.stringContaining("Nothing was sent: openai/gpt-6-astra") }));
      expect(session.outOfReach(chat)?.why).toBe("signed-out");
      // Signed in: the chat is put on it, and what is sent goes on.
      signedIn.add("openai");
      await session.onHarnessModel();
      expect(put).toEqual(["openai/gpt-6-astra"]);
      expect(events.at(-1)).toEqual({ type: "outOfReach", chat, outOfReach: null });
      expect(await send("build the todo app")).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it("says a harness-model there is no such model of, as one it cannot reach", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: openai/gpt-9\n");
    const { session, send, start } = await chatOn([model("openai", "gpt-6-astra")], new Set(["openai"]));
    try {
      await start();
      expect(await send("hello")).toBe(false);
      expect(session.outOfReach(session.chats()[0]!.id)).toEqual({ model: "openai/gpt-9", provider: "openai", why: "unknown" });
    } finally {
      await session.dispose();
    }
  });

  it("keeps a model the person chose until harness-model changes, then goes with it", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: openai/gpt-6-astra\n");
    const models = [model("openai", "gpt-6-astra"), model("openai", "gpt-6-luna"), model("anthropic", "claude-opus-5-5")];
    const { session, put, send, start, choose } = await chatOn(models, new Set(["openai", "anthropic"]));
    try {
      await start();
      choose(model("openai", "gpt-6-luna"));
      expect(await send("go on")).toBe(true);
      expect(put).toEqual(["openai/gpt-6-astra"]);
      writeFileSync(join(project, "config.turri.yaml"), "harness-model: anthropic/claude-opus-5-5\n");
      expect(await send("go on")).toBe(true);
      expect(put).toEqual(["openai/gpt-6-astra", "anthropic/claude-opus-5-5"]);
    } finally {
      await session.dispose();
    }
  });

  it("leaves a chat on pi's own choice when harness-model is unset", async () => {
    const { session, put, send, start } = await chatOn([], new Set());
    try {
      await start();
      expect(await send("hello")).toBe(true);
      expect(put).toEqual([]);
    } finally {
      await session.dispose();
    }
  });
});

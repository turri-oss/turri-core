import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskUser, AskUserIO } from "../src/ask.ts";
import type { CaptureStatus } from "../src/capture/progress.ts";
import type { TurriCore, TurriHost } from "../src/chats.ts";
import type { SessionEvent, SkillProgress } from "../src/session-events.ts";
import type { Job } from "../src/regenerate/jobs.ts";
import type { QuestionView, SidePanelView, TurriView, ViewChat } from "../src/view.ts";

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
function recordingPi() {
  const order: string[] = [];
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
        if (key === "appendEntry") return (type: string) => void order.push(`entry ${type}`);
        return () => undefined;
      },
    },
  ) as never;
  /** The chat's session started, its handlers run in order as pi runs them. */
  const start = async (ctx: unknown) => {
    for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
  };
  return { pi, order, commands, tools, handlers, start };
}

/** A session whose chats are opened by a driver of the test's: each built into a pi of its own, kept in `pis`. */
function withChats(view: TurriView | undefined, terminal = false, host: TurriHost = {}) {
  const session = createTurriCore(host, view !== undefined ? { view } : {});
  const pis: Array<ReturnType<typeof recordingPi>> = [];
  session.setDriver({
    terminal,
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

describe("the view's part of each chat", () => {
  it("keeps CLI upgrade and PATH checks out of an embedded host, including one with no callbacks", async () => {
    const versions = vi.spyOn(await import("../src/turri-versions.ts"), "bannerWarnings");
    try {
      for (const mode of ["host", "chat"] as const) {
        const session = createTurriCore({}, { mode });
        const { pi, start, order } = recordingPi();
        try {
          await session.extension(pi);
          await start(contextOf(false));
          expect(order).toContain("entry turri_banner");
          expect(versions).toHaveBeenCalledTimes(mode === "host" ? 0 : 1);
        } finally { await session.dispose(); }
      }
    } finally { versions.mockRestore(); }
  });
  it("is built into each chat once, in the chat's scope, just before the banner - its session_start before the banner's", async () => {
    const built: ViewChat[] = [];
    const ran: Array<string | undefined> = [];
    let pisOf: Array<ReturnType<typeof recordingPi>> = [];
    const view: TurriView = {
      chat: (pi, chat) => {
        built.push(chat);
        pi.registerCommand("view-probe", { description: "", handler: async () => void ran.push(currentChat()?.id) });
        pi.on("session_start", () => void pisOf[built.indexOf(chat)]!.order.push("view session_start"));
      },
    };
    const { session, pis } = withChats(view);
    pisOf = pis;
    const first = await session.open({ hidden: true });
    const second = await session.open({ hidden: true });

    expect(built.map((chat) => chat.link.id)).toEqual([first.id, second.id]);
    expect(built.every((chat) => chat.session === session)).toBe(true);
    // Where the banner's renderers and painting were registered: right before /stdlib.
    const order = pis[0]!.order;
    expect(order.indexOf("/view-probe")).toBe(order.indexOf("/stdlib") - 1);
    // What it registers runs in its chat's scope.
    await pis[1]!.commands.get("view-probe")!.handler("", {});
    expect(ran).toEqual([second.id]);

    // The chat's context, once its session has started; and the view's start handler runs before the banner is appended.
    expect(built[0]!.context()).toBeUndefined();
    const ctx = contextOf(false);
    await pis[0]!.start(ctx);
    expect(built[0]!.context()).toBe(ctx);
    expect(order.indexOf("view session_start")).toBeGreaterThan(-1);
    expect(order.indexOf("view session_start")).toBeLessThan(order.indexOf("entry turri_banner"));
  });

  it("is not there for a session with no view: the banner is appended all the same, once a chat", async () => {
    const { session, pis } = withChats(undefined);
    await session.open({ hidden: true });
    await pis[0]!.start(contextOf(false));
    await pis[0]!.start(contextOf(false));
    expect(pis[0]!.order.filter((step) => step === "entry turri_banner")).toHaveLength(1);
  });
});

describe("the view's chat commands", () => {
  /** A view that registers /chat, keeping each chat it was built into and the chat its command ran in. */
  function chatCommandsView() {
    const built: ViewChat[] = [];
    const ran: Array<string | undefined> = [];
    const view: TurriView = {
      chatCommands: (pi, chat) => {
        built.push(chat);
        pi.registerCommand("chat", { description: "", handler: async () => void ran.push(currentChat()?.id) });
      },
    };
    return { view, built, ran };
  }

  it("are registered once in each chat of a terminal session, in its scope - right after /btw, right before /capture", async () => {
    const { view, built, ran } = chatCommandsView();
    const { session, pis } = withChats(view, true);
    const first = await session.open({ hidden: true });
    const second = await session.open({ hidden: true });

    expect(built.map((chat) => chat.link.id)).toEqual([first.id, second.id]);
    expect(built.every((chat) => chat.session === session)).toBe(true);
    for (const { order } of pis) {
      expect(order.filter((step) => step === "/chat")).toHaveLength(1);
      // Where turri registered /chat: after the conversation's commands, before the capture and skill commands.
      expect(order.indexOf("/chat")).toBe(order.indexOf("/btw") + 1);
      expect(order.indexOf("/capture")).toBe(order.indexOf("/chat") + 1);
    }
    await pis[1]!.commands.get("chat")!.handler("", {});
    expect(ran).toEqual([second.id]);
  });

  it("are not registered in a session that is not the terminal's", async () => {
    const { view, built } = chatCommandsView();
    const { session, pis } = withChats(view, false);
    await session.open({ hidden: true });
    expect(built).toEqual([]);
    expect(pis[0]!.commands.has("chat")).toBe(false);
    expect(pis[0]!.commands.has("btw")).toBe(true);
  });
});

describe("a pulse's end, for the view", () => {
  it("is told the view just before the chats - every pulse that ended, never one replaced by another", async () => {
    const told: string[] = [];
    const session = createTurriCore({}, { view: { pulseFinished: (job: Job) => void told.push(`view ${job.id} ${job.status}`) } });
    vi.spyOn(session as { jobFinished(job: Job): void }, "jobFinished").mockImplementation((job: Job) => void told.push(`chats ${job.id}`));
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const landed = session.jobs.start({ kind: "test", summary: "a pulse that lands", run: async () => ({ report: "done" }) });
    await settled();
    const failed = session.jobs.start({ kind: "test", summary: "a pulse that fails", run: async () => Promise.reject(new Error("broken")) });
    await settled();
    const replaced = session.jobs.start({
      kind: "test",
      summary: "a pulse queued again",
      run: async () => {
        await gate;
        return { report: "done" };
      },
    });
    replaced.replacedBy = "another";
    release();
    await settled();
    expect(told).toEqual([`view ${landed.id} succeeded`, `chats ${landed.id}`, `view ${failed.id} failed`, `chats ${failed.id}`]);
  });
});

describe("the view's side panel", () => {
  /** A panel that keeps what it was opened on. */
  function panelView() {
    const opened: Array<[string | undefined, string | undefined]> = [];
    let visible = false;
    let made = 0;
    const panel: SidePanelView = {
      open: (_ctx, page, placement) => {
        opened.push([page, placement]);
        visible = true;
      },
      visible: () => visible,
      close: () => {
        visible = false;
      },
    };
    const view: TurriView = {
      panel: (_session: TurriCore) => {
        made++;
        return panel;
      },
    };
    return { view, opened, made: () => made };
  }

  it("is opened by /pulses and /notifications in a chat with a screen - one panel for the session's chats", async () => {
    const { view, opened, made } = panelView();
    const { session, pis } = withChats(view, true);
    await session.open({ hidden: true });
    await session.open({ hidden: true });
    await pis[0]!.commands.get("pulses")!.handler("", contextOf(false));
    await pis[0]!.commands.get("notifications")!.handler("", contextOf(false));
    expect(opened).toEqual([]);
    await pis[0]!.commands.get("pulses")!.handler("", contextOf(true));
    await pis[1]!.commands.get("notifications")!.handler("", contextOf(true));
    expect(opened).toEqual([
      ["pulses", undefined],
      ["notifications", "beside"],
    ]);
    expect(made()).toBe(1);
  });

  it("has /pulses everywhere and /notifications only in the terminal", async () => {
    const { view } = panelView();
    const { session, pis } = withChats(view, false);
    await session.open({ hidden: true });
    expect(pis[0]!.commands.has("pulses")).toBe(true);
    expect(pis[0]!.commands.has("notifications")).toBe(false);
  });

  it("is what the chat header's toggle opens beside the chat, and closes", async () => {
    const { view, opened } = panelView();
    const { session, pis } = withChats(view, true);
    await session.open({ hidden: true });
    const header = session.instanceInScope()!.plainPanel!;
    expect(header.open()).toBe(false);
    // No context yet: nothing to open it in.
    header.toggle();
    expect(opened).toEqual([]);
    await pis[0]!.start(contextOf(true));
    header.toggle();
    expect(opened).toEqual([["map", "beside"]]);
    expect(header.open()).toBe(true);
    header.toggle();
    expect(header.open()).toBe(false);
  });

  it("is none without a view: the toggle does nothing, and /pulses opens nothing", async () => {
    const { session, pis } = withChats(undefined);
    await session.open({ hidden: true });
    await pis[0]!.start(contextOf(true));
    const header = session.instanceInScope()!.plainPanel!;
    expect(header.open()).toBe(false);
    expect(() => header.toggle()).not.toThrow();
    await expect(pis[0]!.commands.get("pulses")!.handler("", contextOf(true))).resolves.toBeUndefined();
  });
});

describe("a capture's progress", () => {
  it("gives a host snapshots and one outcome in the chat that started it, without a terminal view", async () => {
    const events: Extract<SessionEvent, { type: "captureProgress" | "captureEnded" }>[] = [];
    const { session, pis } = withChats(undefined, false, { onEvent(event) {
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

  it("runs on the project's models, not the chat's, and opens the captured project on its own config", async () => {
    const reopenFile = join(project, "reopen.json");
    process.env.TURRI_REOPEN_FILE = reopenFile;
    const { session, pis } = withChats(undefined);
    try {
      await session.open();
      const run = vi.mocked((await import("../src/capture/capture.ts")).runCapture);
      run.mockClear();
      let shutdown = 0;
      // The chat on pi's fallback model: none of it reaches the capture, or turri opened again in what it wrote.
      const ctx = { ...contextOf(true, { confirm: async () => true }), model: { provider: "anthropic", id: "claude-fallback" }, shutdown: () => void shutdown++ };
      await pis[0]!.commands.get("capture")!.handler("", ctx);
      await vi.waitFor(() => expect(shutdown).toBe(1));
      expect(run).toHaveBeenCalledTimes(1);
      const options = run.mock.calls[0]![0];
      expect(options).toMatchObject({ root: project, configFrom: project });
      expect(options).not.toHaveProperty("model");
      expect(options).not.toHaveProperty("harnessModel");
      expect(JSON.parse(readFileSync(reopenFile, "utf8"))).toMatchObject({ dir: join(project, "plain"), args: [] });
    } finally {
      delete process.env.TURRI_REOPEN_FILE;
      await session.dispose();
    }
  });

  it("is drawn by the view only in a chat with a screen: each status, and closed once it ends", async () => {
    const shown: Array<{ ctx: unknown; updates: CaptureStatus[]; closed: number }> = [];
    const view: TurriView = {
      captureProgress: (ctx) => {
        const drawn = { ctx: ctx as unknown, updates: [] as CaptureStatus[], closed: 0 };
        shown.push(drawn);
        return { update: (status) => void drawn.updates.push(status), close: () => void drawn.closed++ };
      },
    };
    const { session, pis } = withChats(view);
    await session.open({ hidden: true });
    const capture = pis[0]!.commands.get("capture")!;
    await capture.handler("", contextOf(false));
    await settled();
    expect(shown).toEqual([]);
    const ctx = contextOf(true);
    await capture.handler("", ctx);
    await settled();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.ctx).toBe(ctx);
    expect(shown[0]!.updates).toEqual([watched]);
    expect(shown[0]!.closed).toBeGreaterThan(0);
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
  const drawn: Array<SkillProgress | null> = [];
  const session = createTurriCore({ onEvent: (e) => events.push(e) }, { view: { skillProgress: (_ctx, p) => drawn.push(p) } });
  const { pi, tools } = recordingPi();
  await session.extension(pi);
  try {
    await expect(tools.get("cultivate")!.execute("id", { skill: "probe" }, undefined, undefined, contextOf(true))).rejects.toThrow("interrupted test run");
    expect(drawn).toEqual([
      { skill: "probe", phases: ["stack", "product"], current: -1, attempt: 1 },
      { skill: "probe", phases: ["stack", "product"], current: 0, attempt: 1, about: "chooses" },
      { skill: "probe", phases: ["stack", "product"], current: 0, attempt: 2, about: "chooses" }, null,
    ]);
    expect(events.filter((e) => e.type === "skillProgress")).toEqual(drawn.map((progress) => ({ type: "skillProgress", chat: session.chats()[0]!.id, progress })));
  } finally {
    await session.dispose();
  }
});

describe("pi's own settings, last in /settings", () => {
  const pickPi = (notified: string[]) =>
    contextOf(true, { select: async (_title: string, lines: string[]) => lines[lines.length - 1], notify: (message: string) => void notified.push(message) });

  it("open through the view where it has a screen for them", async () => {
    const opened: string[] = [];
    const notified: string[] = [];
    const { session, pis } = withChats({ openPiSettings: () => opened.push("pi") > 0 });
    await session.open({ hidden: true });
    await pis[0]!.commands.get("settings")!.handler("", pickPi(notified));
    expect(opened).toEqual(["pi"]);
    expect(notified).toEqual([]);
  });

  it("are said to open only in the terminal's chat without a view", async () => {
    const notified: string[] = [];
    const { session, pis } = withChats(undefined);
    await session.open({ hidden: true });
    await pis[0]!.commands.get("settings")!.handler("", pickPi(notified));
    expect(notified).toEqual(["pi's own settings open only in the terminal's chat."]);
  });
});

describe("a question in a chat with a screen", () => {
  it("is put in pi's own dialogs with neither a host's nor a view's - what to read above the question", async () => {
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

  /** A view's way of asking, keeping what it was asked and when its keys were let through. */
  function viewQuestions(events: string[], answer: (options: string[], decline: () => void, declining: { close: (() => void) | undefined }) => Promise<string | undefined>) {
    const questions: QuestionView = {
      dialogs: (_ctx, declining, decline) => ({
        select: async (title, options) => {
          events.push(`view asked ${title}`);
          return answer(options, decline, declining);
        },
        input: async () => undefined,
      }),
      whileAsking: () => {
        events.push("keys let through");
        return () => events.push("keys back");
      },
    };
    return questions;
  }

  it("is put in the view's dialogs over pi's, the view's keys let through until it is answered", async () => {
    const events: string[] = [];
    const questions = viewQuestions(events, async (options) => options[0]);
    const ctx = contextOf(true, { select: async () => void events.push("pi's select") });
    const answer = await askUserVia(ctx as never, () => {}, undefined, undefined, questions)({ question: "Ship it?", options: ["Yes", "Not yet"] });
    expect(answer).toBe("Yes");
    expect(events).toEqual(["keys let through", "view asked Ship it?", "keys back"]);
  });

  it("comes back declined from the view's dialog - the person declining at it, or the turn stopped while it is open", async () => {
    const events: string[] = [];
    const declinedThere = viewQuestions(events, async (_options, decline) => {
      decline();
      return undefined;
    });
    expect(await askUserVia(contextOf(true) as never, () => {}, undefined, undefined, declinedThere)({ question: "Ship it?", options: ["Yes"] })).toBe(DECLINED);

    const turn = new AbortController();
    let closed = false;
    const stoppedWhileOpen = viewQuestions(events, (_options, _decline, declining) =>
      new Promise((resolve) => {
        declining.close = () => {
          closed = true;
          resolve(undefined);
        };
      }),
    );
    const asked = askUserVia({ ...contextOf(true), signal: turn.signal } as never, () => {}, undefined, undefined, stoppedWhileOpen)({ question: "Ship it?", options: ["Yes"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    turn.abort();
    expect(await asked).toBe(DECLINED);
    expect(closed).toBe(true);
  });

  it("is put in the host's dialogs over the view's and pi's", async () => {
    const events: string[] = [];
    const questions = viewQuestions(events, async (options) => options[0]);
    const host: AskUserIO = {
      select: async (title, options) => {
        events.push(`host asked ${title}`);
        return options[1];
      },
      input: async () => undefined,
    };
    const ctx = contextOf(true, { select: async () => void events.push("pi's select"), setWorkingMessage: () => void events.push("working message") });
    const answer = await askUserVia(ctx as never, () => {}, undefined, host, questions)({ question: "Ship it?", options: ["Yes", "Not yet"] });
    expect(answer).toBe("Not yet");
    expect(events).toEqual(["host asked Ship it?"]);
  });

  it("is put in the view's dialogs from the conversation's ask_user too", async () => {
    const events: string[] = [];
    const tool = chatAskUserTool(undefined, undefined, viewQuestions(events, async (options) => options[1]));
    const result = await (tool.execute as (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>)(
      "id",
      { question: "Ship it?", options: ["Yes", "Not yet"] },
      undefined,
      undefined,
      contextOf(true),
    );
    expect(result.content[0]!.text).toContain("Not yet");
    expect(events).toEqual(["keys let through", "view asked Ship it?", "keys back"]);
  });

  /** A chat's context with a screen whose own dialogs say so when they are opened. */
  const withPiDialogs = (events: string[]) =>
    contextOf(true, {
      select: async () => void events.push("pi's select"),
      input: async () => void events.push("pi's input"),
      setWidget: () => {},
    });

  it("is put in the view's dialogs from the ask_user of a session's chat, never in pi's", async () => {
    const events: string[] = [];
    const { session, pis } = withChats({ questions: viewQuestions(events, async (options) => options[1]) });
    await session.open({ hidden: true });
    const result = await pis[0]!.tools.get("ask_user")!.execute("id", { question: "Ship it?", options: ["Yes", "Not yet"] }, undefined, undefined, withPiDialogs(events));
    expect(result.content[0]!.text).toContain("Not yet");
    expect(events).toEqual(["keys let through", "view asked Ship it?", "keys back"]);
  });

  it("is put in the view's dialogs from a skill's interview in a session's chat, never in pi's", async () => {
    const events: string[] = [];
    const { session, pis } = withChats({ questions: viewQuestions(events, async (options) => options[1]) });
    await session.open({ hidden: true });
    const result = await pis[0]!.tools.get("cultivate")!.execute("id", { skill: "debug-specs", context: "The specs disagree." }, undefined, undefined, withPiDialogs(events));
    expect(result.content[0]!.text).toContain("<artifact>\nDjango\n</artifact>");
    expect(events).toEqual(["keys let through", "view asked Which stack?", "keys back"]);
  });
});

import type { AgentSession, ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { currentChat, inChat } from "../src/chat-scope.ts";
import { createChats, INTERRUPT_SETTLE_MS, interruptChat, MAX_CHATS, scopedToChat, type ChatLink, type Stoppable, type TurriCore } from "../src/chats.ts";
import { createJobRegistry, type Job } from "../src/regenerate/jobs.ts";

/** A pi session as the session follows it: its events, sent by the test. */
function fakeSession() {
  const listeners = new Set<(event: { type: string }) => void>();
  const session = {
    subscribe: (listener: (event: { type: string }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sessionFile: undefined,
    messages: [],
    getSessionStats: () => ({ cost: 0 }),
    sessionManager: { getSessionName: () => undefined },
    extensionRunner: { getUIContext: () => undefined },
  } as unknown as AgentSession;
  return { session, emit: (type: string) => listeners.forEach((listener) => listener({ type })) };
}

/** A session whose chats live nowhere but here: each chat's extension links itself, and is told what ends. */
function session() {
  const told = new Map<string, string[]>();
  const links: ChatLink[] = [];
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  let core: TurriCore;
  const jobs = createJobRegistry({ onFinish: (job) => core.jobFinished(job) });
  core = createChats({
    cwd: process.cwd(),
    host: {},
    jobs,
    extension: (_pi, link) => {
      links.push(link);
      link.live({
        announce: (job: Job) => told.set(link.id, [...(told.get(link.id) ?? []), job.summary]),
        thinkingLevel: () => undefined,
        context: () => undefined,
      });
    },
  });
  core.setDriver({
    async create(chat) {
      core.extension({} as ExtensionAPI);
      const made = fakeSession();
      sessions.set(chat.id, made);
      chat.session = made.session;
    },
    async dispose() {},
  });
  return { core, jobs, told, links, sessions };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Chats on a front end's own pi sessions, as its driver keeps them: each on a session of its own, the one in front shown
 * when turri asks. What it was asked to show is kept.
 */
function frontEndSession() {
  const shown: string[] = [];
  const core = createChats({ cwd: process.cwd(), host: {}, jobs: createJobRegistry(), extension: () => {} });
  core.setDriver({
    async create(chat) {
      core.extension({} as ExtensionAPI);
      chat.session = Object.assign(fakeSession().session, {
        disposed: false,
        dispose() {
          this.disposed = true;
        },
      });
    },
    async show(chat) {
      shown.push(chat.id);
      core.showing(chat);
    },
    async dispose(chat) {
      chat.session?.dispose();
    },
  });
  /** The chat's pi session, and whether it was let go. */
  const sessionOf = (id: string) => core.session(id) as AgentSession & { disposed: boolean };
  return { core, shown, sessionOf };
}

describe("the chats of a session", () => {
  it(`opens up to ${MAX_CHATS} chats, each shown as it opens, and refuses one more`, async () => {
    const { core } = session();
    for (let index = 0; index < MAX_CHATS; index += 1) await core.open();
    expect(core.chats()).toHaveLength(MAX_CHATS);
    expect(core.chats().filter((chat) => chat.shown).map((chat) => chat.id)).toEqual([core.chats().at(-1)!.id]);
    await expect(core.open()).rejects.toThrow(`${MAX_CHATS} chats are open, the most there can be: close one first.`);
  });

  it("calls a chat nothing was said in a new chat", async () => {
    const { core } = session();
    await core.open();
    await core.open();
    expect(core.chats().map((chat) => chat.title)).toEqual(["new chat", "new chat"]);
  });

  it("opens a chat hidden when asked, leaving the one shown as it is", async () => {
    const { core } = session();
    const first = await core.open();
    await core.open({ hidden: true });
    expect(core.shown()).toBe(first.id);
  });

  it("tells the chat that asked for a pulse how it went, shown or not", async () => {
    const { core, jobs, told, links } = session();
    await core.open();
    await core.open();
    const [asker] = links;
    inChat(asker!.scope, () => jobs.start({ kind: "render", summary: "app pulse 1", run: async () => ({ report: "done" }) }));
    await settled();
    expect(told.get(asker!.id)).toEqual(["app pulse 1"]);
    expect(told.get(links[1]!.id)).toBeUndefined();
    expect(core.chats().find((chat) => chat.id === asker!.id)?.status).toBe("unread");
  });

  it("tells the chat shown of a pulse whose chat was closed", async () => {
    const { core, jobs, told, links } = session();
    await core.open();
    await core.open();
    const [asker, other] = links;
    let finish: () => void = () => {};
    inChat(asker!.scope, () => jobs.start({ kind: "render", summary: "app pulse 2", run: () => new Promise((resolve) => (finish = () => resolve({ report: "done" }))) }));
    await core.close(asker!.id);
    finish();
    await settled();
    expect(told.get(other!.id)).toEqual(["app pulse 2"]);
  });

  it("shows the next chat when the one shown is closed", async () => {
    const { core } = session();
    const first = await core.open();
    const second = await core.open();
    await core.show(first.id);
    await core.close(first.id);
    expect(core.shown()).toBe(second.id);
    expect(core.chats().map((chat) => chat.id)).toEqual([second.id]);
  });

  it("says a hidden chat is working, then that it has something new, until it is shown", async () => {
    const { core, sessions } = session();
    const hidden = await core.open();
    await core.open();
    const status = () => core.chats().find((chat) => chat.id === hidden.id)?.status;
    sessions.get(hidden.id)!.emit("agent_start");
    expect(status()).toBe("working");
    sessions.get(hidden.id)!.emit("agent_end");
    expect(status()).toBe("unread");
    await core.show(hidden.id);
    expect(status()).toBe("idle");
  });

  it("tells every front end what it says once, and the first chat shown what was said before any could show it", async () => {
    const events: Array<{ type: string; text?: string }> = [];
    const shown: string[] = [];
    let core: TurriCore;
    core = createChats({ cwd: process.cwd(), host: { onEvent: (event) => events.push(event as never) }, jobs: createJobRegistry(), extension: () => {} });
    core.setDriver({
      async create(chat) {
        const made = fakeSession();
        (made.session as unknown as { extensionRunner: unknown }).extensionRunner = { getUIContext: () => ({ notify: (message: string) => shown.push(message) }) };
        chat.session = made.session;
      },
      async dispose() {},
    });
    core.notify("said before any chat", "warning");
    await core.open();
    expect(shown).toEqual(["said before any chat"]);
    core.notify("said in the chat", "info");
    expect(shown).toEqual(["said before any chat", "said in the chat"]);
    expect(events.filter((event) => event.type === "notification").map((event) => event.text)).toEqual(["said before any chat", "said in the chat"]);
  });

  it("has one chat and nowhere to open another without a driver", async () => {
    const core = createChats({ cwd: process.cwd(), host: {}, jobs: createJobRegistry(), extension: () => {} });
    expect(core.canOpen).toBe(false);
    await expect(core.open()).rejects.toThrow("This turri has one chat");
  });
});

describe("chats on a front end's own sessions", () => {
  it("opens a chat beside the first and switches between them, nothing let go - a question asked in a hidden one its status", async () => {
    const { core, shown, sessionOf } = frontEndSession();
    await core.open();
    const firstId = core.shown()!;
    await core.open();
    expect(core.chats().map((chat) => chat.shown)).toEqual([false, true]);
    const secondId = core.shown()!;

    // turri asks in the first chat while it is hidden: its status says so, and the listeners hear it, until it is over.
    let told = 0;
    core.onChats(() => (told += 1));
    const first = core.chatOfSession(sessionOf(firstId))!;
    const decline = () => {};
    first.scope.asking.add(decline);
    expect(core.chats()[0]!.status).toBe("question");
    first.scope.asking.delete(decline);
    expect(core.chats()[0]!.status).not.toBe("question");
    expect(told).toBe(2);

    await core.show(firstId);
    expect(shown).toEqual([firstId, secondId, firstId]);
    expect(core.shown()).toBe(firstId);

    // Leaving turri lets the other chat go; a front end that lets go of one itself keeps it.
    const [firstSession, secondSession] = [sessionOf(firstId), sessionOf(secondId)];
    await core.dispose({ except: firstSession });
    expect(secondSession.disposed).toBe(true);
    expect(firstSession.disposed).toBe(false);
  });
});

describe("ctrl+c in the chat shown", () => {
  /**
   * The chat shown doing `doing`, as ctrl+c reaches it, and what was done to it. `press` is ctrl+c as the terminal
   * presses it (turri's chat-terminal.ts `pressCtrlC`): its turn stopped with pi's own esc, and in a chat doing nothing,
   * a draft in the editor cleared, else turri left.
   */
  const screenDoing = (doing: { streaming?: boolean; bash?: boolean; compacting?: boolean; draft?: string } = {}) => {
    const did: string[] = [];
    const session: Stoppable = {
      isStreaming: doing.streaming === true,
      isBashRunning: doing.bash === true,
      isCompacting: doing.compacting === true,
      isRetrying: false,
      abort: async () => void did.push("abort"),
      abortBash: () => void did.push("abortBash"),
    };
    const press = (lastStop: number, now = Date.now()) =>
      interruptChat(session, {
        lastStop,
        now,
        stopTurn: () => void did.push("stop turn"),
        idle: () => {
          if ((doing.draft ?? "").trim() !== "") {
            did.push("clear");
            return "cleared" as const;
          }
          did.push("leave");
          return "left" as const;
        },
      });
    return { press, did };
  };

  it("stops the turn it is in - a skill, a tool - keeping the draft and turri", () => {
    const { press, did } = screenDoing({ streaming: true, draft: "half a thought" });
    expect(press(0)).toBe("stopped");
    expect(did).toEqual(["stop turn"]);
  });

  it("stops a ! command and a compaction", () => {
    const bash = screenDoing({ bash: true });
    bash.press(0);
    expect(bash.did).toEqual(["abortBash"]);
    const compacting = screenDoing({ compacting: true });
    compacting.press(0);
    expect(compacting.did).toEqual(["abort"]);
  });

  it("leaves turri when the chat is doing nothing", () => {
    const { press, did } = screenDoing();
    expect(press(0)).toBe("left");
    expect(did).toEqual(["leave"]);
  });

  it("gives back the front end's answer for a chat doing nothing - here a draft cleared, turri not left", () => {
    const { press, did } = screenDoing({ draft: "not sent" });
    expect(press(0)).toBe("cleared");
    expect(did).toEqual(["clear"]);
  });

  it("does not leave on a press straight after one that stopped something", () => {
    const now = 10_000;
    const { press, did } = screenDoing();
    expect(press(now - 100, now)).toBe("ignored");
    expect(press(now - INTERRUPT_SETTLE_MS, now)).toBe("left");
    expect(did).toEqual(["leave"]);
  });
});

describe("what each chat keeps for itself", () => {
  it("runs every tool, command and handler a chat's extension registers in the chat's scope", async () => {
    const registered: Record<string, (...args: unknown[]) => unknown> = {};
    const pi = {
      registerTool: (tool: { name: string; execute: (...args: unknown[]) => unknown }) => (registered[tool.name] = tool.execute),
      registerCommand: (name: string, command: { handler: (...args: unknown[]) => unknown }) => (registered[`/${name}`] = command.handler),
      on: (event: string, handler: (...args: unknown[]) => unknown) => (registered[event] = handler),
    } as unknown as ExtensionAPI;
    const scoped = scopedToChat(pi, { id: "c1" });
    scoped.registerTool({ name: "t", execute: async () => currentChat()?.id } as never);
    scoped.registerCommand("c", { handler: async () => currentChat()?.id } as never);
    scoped.on("agent_end", (() => currentChat()?.id) as never);
    expect(await registered.t!()).toBe("c1");
    expect(await registered["/c"]!()).toBe("c1");
    expect(registered.agent_end!()).toBe("c1");
    expect(currentChat()).toBeUndefined();
  });
});

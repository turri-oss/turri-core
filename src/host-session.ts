import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type AgentSession, type ExtensionFactory, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AskUserIO } from "./ask.ts";
import { lastRun } from "./chat-records.ts";
import { resolve } from "node:path";
import { isChatEntry, type ChatEntry } from "./chat-entries.ts";
import { emitSessionEvent } from "./session-events.ts";
import { lookAhead, nextPulses } from "./preview.ts";
import { projectStanding, type ModuleStanding } from "./regenerate/standing.ts";
import { interruptChat, type ChatInfo, type TurriHost } from "./chats.ts";
import { reachable, ruleNames, settingCandidates } from "./settings.ts";
import { settingOf } from "./config-edit.ts";
import { createTurriCore, plannedLoop, sessionLaunchesOf, sessionLoop, turnOnConformance } from "./extension.ts";
import type { Launch } from "./launch-track.ts";
import type { SessionSpending } from "./session-spending.ts";
import { stopLaunched } from "./regenerate/launch.ts";
import type { Job } from "./regenerate/jobs.ts";
import type { ModuleStatus, PlannedPulse } from "./regenerate/loop.ts";
import type { Notice, NoticeAnswer } from "./notice.ts";
import { prepareCheck, type CheckRequest } from "./sentinel-check.ts";

/**
 * turri's session for a host that runs its chats itself - a desktop app, an editor: the chats, each a pi session with
 * turri in it, on one job registry and work loop. The host shows each chat in its own way - subscribes to its session,
 * prompts it - and tells turri which one its person looks at (`focus`): a pulse a closed chat asked for is reported
 * there.
 */

export interface TurriOptions extends Omit<TurriHost, "dialogs"> {
  /** pi's folder - its settings, models and credentials. Default: pi's own (`~/.pi/agent`). */
  agentDir?: string;
  /** Where the chats' conversations are saved. Default: pi's own folder for this project. */
  sessionDir?: string;
  /** The host's own extensions, built into every chat after turri's. */
  extensions?: ExtensionFactory[];
  /**
   * The dialogs a chat's questions are put in - ask_user's, a skill's interview, a review gate's - by the chat's id. Each
   * is given a `signal`, aborted when its question is over without its answer - declined, or its turn stopped - for the
   * host to close it.
   */
  dialogs?: (chat: string) => AskUserIO | undefined;
  /** What a chat's other UI calls - its notices, its working line - come to, by the chat's id. */
  uiContext?: (chat: string) => ExtensionUIContext | undefined;
  /** Reopen the chats of the last session here that has ended, in their order - as `turri --continue` does. */
  restore?: boolean;
}

export interface Turri {
  /** A snapshot of this session's launches, oldest first, including stopped and replaced ones. */
  launches(): Launch[];
  /** Dollars spent since this session opened, including closed chats and earlier sentinel conversations. */
  spending(): SessionSpending;
  /** Every job of this session, including retries; undefined for an unknown job id. */
  jobs(): Job[];
  job(id: string): Job | undefined;
  /** What the Pulses view shows now, including plans held by a look ahead. */
  status(): { modules: (ModuleStatus & { lookedAhead?: boolean })[]; jobs: Job[]; planned: Job[] };
  /** Read drift and completion, even before the first chat opens. Never plans or starts work. */
  standing(files?: string[]): ModuleStanding[];
  /** Plan on the chats' own loop, hold the plan and return its next prompts - on the config's models when no chat is open. */
  lookAhead(plainFile: string): Promise<{ statuses: ModuleStatus[]; next: PlannedPulse[] }>;
  /** turri's custom entries in the chat's current branch, in transcript order. */
  entries(chat: string): ChatEntry[];
  /** The chats, in their order. */
  chats(): ChatInfo[];
  /** A chat's pi session: to subscribe to, prompt and abort. */
  session(id: string): AgentSession | undefined;
  /** A fresh chat - or the saved one `sessionFile` is. At most nine are open. */
  openChat(options?: { sessionFile?: string }): Promise<ChatInfo & { session: AgentSession }>;
  /** A chat closed: its turn stopped, its conversation deleted - its pulses run on. */
  closeChat(id: string): Promise<void>;
  /** The chat the person looks at now. */
  focus(id: string): void;
  /**
   * ctrl+c in a chat, as the terminal has it: what the chat is doing stopped - its turn, a skill or a tool in it, a `!`
   * command, a compaction - and nothing in the others (`stopped`). In a chat doing nothing the session ends - every
   * chat let go and what launches started stopped, as `dispose` does - for the host to close what showed it (`ended`).
   * A second interrupt straight after one that stopped something does nothing (`ignored`); `missing` for a chat not open.
   */
  interrupt(id: string): Promise<"stopped" | "ignored" | "ended" | "missing">;
  /**
   * ctrl+c at a question, as the terminal has it: the question the chat asks now - its ask_user, a skill's interview, a
   * review gate's escalation - declined. The asker is told the person declined to answer and the turn goes on; the
   * host's dialog for it is told through its `signal`. Each question it is called at, however many in a row - it never
   * stops the turn. `none` when the chat asks nothing now, `missing` for a chat not open.
   */
  decline(id: string): Promise<"declined" | "none" | "missing">;
  /**
   * The notices put to the person and not yet over - the sentinel's, and turri's own: each in the chat it names. A host
   * hears each as it is put (`onNotice`) and as it ends (`onNoticeOver`).
   */
  notices(): Notice[];
  /**
   * The sentinel asked to check functional specs in what is launched of a module - `funcIds` each `module:func-id`, of the
   * module or of any module its requires chain builds on (a bare func-id is the module's own) - as it tests a launch after a
   * pulse: the module's own codebase's code, which holds every module its chain builds on. Nothing launched of it, the
   * check ends unchecked: the sentinel launches nothing. Queued behind the
   * sentinel's work, in a conversation of its own. Returns the check's id - its notices and its conclusion carry it - or
   * why it was refused: the sentinel off or not started this session, a module not there or that does not parse, a
   * module outside its chain, a func-id a module does not have, one not built in its codebase as its ***plain has it now.
   */
  check(request: CheckRequest): { check: string } | { refused: string };
  /**
   * Every value /settings offers for a setting after `typed` - what its completions compute, in their order, but
   * whole: uncapped, and without "unset", which a host draws itself; the values alone, not `<key> <value>`. A model
   * setting's are every model of every provider signed in to, from the model registry the chats use - and after a colon,
   * `harness-model amazon-bedrock/global.anthropic.claude-opus-5-5:`, that model's thinking levels. An unknown key gives none.
   */
  settingChoices(key: string, typed?: string): string[];
  /**
   * Conformance tests turned on, as /conform does before it tests - the person's decision, a host's switch for it:
   * `conformance-tests: true` written where the module's value comes from - its own `config.turri.<module>.yaml`, or a required module's, when
   * that sets the key, else `config.turri.yaml` - the chats' conform no longer refused. `plainFile`, absolute or from the
   * project, picks the module; omitted,
   * the project's. Returns the file written, from the project. Starts no conformance pulse: that is `conform`'s.
   */
  turnOnConformanceTests(plainFile?: string): string;
  /**
   * A notice answered: one of its actions (by index or label) - the chat it is in started on it - the person's own words
   * about it, dismissed, or - `ignorable: true` - ignored for good: left as the build has it, the sentinel told not to
   * raise it again. `refused` for `ignore` on one that is not ignorable, `over` when it was answered or superseded
   * already, `missing` for one never put.
   */
  answer(id: string, answer: NoticeAnswer): Promise<"done" | "dismissed" | "ignored" | "refused" | "missing" | "over">;
  /** Told when a chat is opened, closed, renamed, or starts or stops working. */
  onChats(listener: (chats: ChatInfo[]) => void): () => void;
  /** Every chat let go, and what launches started stopped. */
  dispose(): Promise<void>;
}

/** turri's session in a host, in the process's working folder - the project's. */
export async function createTurri(options: TurriOptions = {}): Promise<Turri> {
  const { dialogs, uiContext, extensions = [], agentDir = getAgentDir(), sessionDir, restore, ...host } = options;
  const core = createTurriCore(host, { mode: "host", persist: true, ...(dialogs !== undefined ? { dialogs } : {}) });
  const cwd = core.cwd;
  core.setDriver({
    async create(chat, sessionFile) {
      const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: [core.extension, ...extensions] });
      await resourceLoader.reload();
      const sessionManager = sessionFile !== undefined ? SessionManager.open(sessionFile, sessionDir) : SessionManager.create(cwd, sessionDir);
      const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager });
      chat.session = session;
      // Listen before binding: the banner and other session_start entries precede openChat's return.
      if (host.onEvent) session.subscribe((event) => {
        // pi announces a custom entry as entry_appended but a delivered custom message as message_end.
        const entry = event.type === "entry_appended" ? event.entry : event.type === "message_end" && event.message.role === "custom"
          ? { type: "custom_message" as const, customType: event.message.customType, content: event.message.content, details: event.message.details, display: event.message.display } : undefined;
        if (entry && isChatEntry(entry)) emitSessionEvent(host, { type: "entry", chat: chat.id, entry });
      });
      try {
        await session.bindExtensions({ uiContext: uiContext?.(chat.id), mode: "tui" });
      } catch (error) {
        session.dispose();
        throw error;
      }
    },
    async dispose(chat) {
      const session = chat.session;
      if (session === undefined) return;
      try {
        await session.abort();
      } finally {
        session.dispose();
      }
    },
  });
  if (restore === true) {
    const saved = lastRun(cwd);
    if (saved !== undefined) await core.restore(saved);
    const first = core.chats()[0];
    if (first !== undefined) await core.show(first.id);
  }
  let lastStop = 0;
  const dispose = async () => {
    await core.dispose();
    await stopLaunched();
  };
  return {
    launches: () => structuredClone(sessionLaunchesOf(core.jobs)!.track.list()),
    spending: core.spending,
    jobs: () => core.jobs.list(),
    job: (id) => core.jobs.get(id),
    status() {
      const loop = plannedLoop(core.jobs);
      const planned = loop?.planned() ?? [];
      const held = new Set(planned.filter((job) => job.lookedAhead).map((job) => job.module));
      return { modules: (loop?.status() ?? []).map((row) => held.has(row.module) ? { ...row, lookedAhead: true } : row), jobs: core.jobs.list().filter((job) => !job.replacedBy), planned };
    },
    standing: (files) => projectStanding(cwd, { files, loop: plannedLoop(core.jobs) }),
    async lookAhead(plainFile) {
      const loop = sessionLoop(core);
      const statuses = await lookAhead(loop, resolve(cwd, plainFile));
      const next: PlannedPulse[] = [];
      for await (const pulse of nextPulses(loop, statuses)) next.push(pulse);
      return { statuses, next };
    },
    entries: (id) => core.session(id)?.sessionManager.getBranch().filter(isChatEntry) ?? [],
    chats: () => core.chats(),
    session: (id) => core.session(id),
    async openChat(asked = {}) {
      const chat = await core.open(asked);
      return { ...chat, session: core.session(chat.id)! };
    },
    closeChat: (id) => core.close(id),
    focus: (id) => void core.show(id),
    async interrupt(id) {
      const session = core.session(id);
      if (session === undefined) return "missing";
      const did = interruptChat(session, { lastStop, idle: () => "ended" as const });
      if (did === "stopped") lastStop = Date.now();
      if (did === "ended") await dispose();
      return did;
    },
    decline: async (id) => core.decline(id),
    notices: () => core.notices(),
    check: (request) => core.check(() => prepareCheck(cwd, request)),
    turnOnConformanceTests: (plainFile) => turnOnConformance(core, plainFile),
    settingChoices: (key, typed = "") => {
      const setting = settingOf(key, ruleNames());
      if (setting === undefined) return [];
      // The models from a chat's own context - the one shown, else any open: the registry the chats use, whether or not one
      // has run /settings.
      const context = () => {
        const shown = core.shownChat();
        const states = [shown, ...core.chats().map((chat) => core.session(chat.id)).map((session) => (session !== undefined ? core.chatOfSession(session) : undefined))];
        for (const state of states) {
          try {
            const context = state?.instance?.context();
            if (context !== undefined) return context;
          } catch {
            /* a context let go: the next one */
          }
        }
        return undefined;
      };
      return settingCandidates(setting, typed, { cwd, models: () => reachable(context()) });
    },
    answer: async (id, answer) => core.answer(id, answer),
    onChats: (listener) => core.onChats(() => listener(core.chats())),
    dispose,
  };
}

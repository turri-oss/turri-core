import { resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type AgentSession, type ExtensionAPI, type ExtensionFactory, type ExtensionUIContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { runAsk, type AskUserIO, type DialogAsked } from "./ask.ts";
import { inChat } from "./chat-scope.ts";
import { isChatEntry, type ChatEntry } from "./chat-entries.ts";
import { lastRun, type RunRecord } from "./chat-records.ts";
import { interruptChat, type ChatInfo, type ChatState, type TurriCore, type TurriHost } from "./chats.ts";
import type { ClientInfo } from "./client.ts";
import { modelSpec, projectModels, readProjectConfig, setConfigOverrides, splitModelSpec, dropConfigOverride, type ConfigOverrides } from "./config.ts";
import { currentValue, parseValue, readConfigText, readModuleConfigText, settingOf, shownValue, writeSetting, EFFECT_TEXT, overriddenBy } from "./config-edit.ts";
import { applyBedrockRegion } from "./bedrock-region.ts";
import { createTurriCore, parallelJobs, plannedLoop, sessionLaunchesOf, sessionLoop, turnOnConformance } from "./extension.ts";
import { PACKAGE_ROOT } from "./environment.ts";
import { isTurriError, TurriError } from "./errors.ts";
import { runSkill } from "./genome.ts";
import { LOADING_PROVIDERS } from "./installed-providers.ts";
import { haltLaunched, stopJob } from "./loop-tools.ts";
import { lookAhead, nextPulses } from "./preview.ts";
import { describeTurnIncident, type ModelEvent } from "./regenerate/activity.ts";
import type { Job } from "./regenerate/jobs.ts";
import { followLaunchedLogs, runningLaunched, stopLaunched } from "./regenerate/launch.ts";
import { onLedgerEvent } from "./regenerate/ledger.ts";
import { earlierPulses, ledgerProjects, type RunView } from "./regenerate/ledger-view.ts";
import type { ModuleStatus, PlannedPulse } from "./regenerate/loop.ts";
import { skillRunDir } from "./regenerate/paths.ts";
import { createSpecMapSource, defaultMapFiles, type MarkedPage } from "./regenerate/spec-map.ts";
import { projectStanding, type ModuleStanding } from "./regenerate/standing.ts";
import { prepareCheck, type CheckRequest } from "./sentinel-check.ts";
import type { CaptureResult } from "./capture/capture.ts";
import type { CaptureStatus } from "./capture/progress.ts";
import type { Launch } from "./launch-track.ts";
import type { Conclusion, Notice, NoticeAnswer } from "./notice.ts";
import type { SessionEvent, SkillProgress } from "./session-events.ts";
import type { SessionSpending } from "./session-spending.ts";
import { reachable, ruleNames, settingCandidates } from "./settings.ts";
import { discoverSkills } from "./skills.ts";
import { runWork, type WorkRequest, type WorkResult, type WorkRunOptions } from "./work.ts";

/**
 * turri's session: one project's chats, work, launches and sentinel, for any front end - a terminal, a desktop app, an
 * editor's extension - or none at all, for unattended work. What a front end does differently it says in `Frontend`;
 * what happens it hears as typed events; what it asks it asks of the session's methods. One session a process, in the
 * process's working folder: the project.
 */

/** A question turri puts to the person: options to pick from, or words to type. */
export type Question =
  | { kind: "select"; title: string; options: string[]; /** What to read to answer it. */ context?: string; /** The option to start on. */ at?: number }
  | { kind: "input"; title: string; context?: string };

/** Where a front end shows what turri asks it to: every pulse, one pulse, the spec map. */
export type RevealTarget = { kind: "pulses" | "map" } | { kind: "pulse"; id: string };

/** turri makes each chat's pi session itself, and lets it go. */
export interface ManagedSessions {
  kind: "managed";
  /** What a chat's UI calls - an extension's notify, its working line, a dialog of its own - reach, by the chat's id. */
  ui?(chat: string): ExtensionUIContext | undefined;
}

/**
 * The front end makes each chat's pi session on its own pi runtime - pi's interactive mode, say - with `Turri.extension`
 * built into it before `create` resolves, and lets it go itself.
 */
export interface ExternalSessions {
  kind: "external";
  create(request: SessionRequest): Promise<AgentSession>;
  /** Put the chat in front, when turri asks: a notice in it, a chat opened to be shown. */
  show?(chat: string): Promise<void>;
  /** The chat is closed, or the session ends: its pi session let go. */
  release?(chat: string, session: AgentSession): Promise<void>;
}

export interface SessionRequest {
  chat: string;
  /** A saved conversation to reopen; none, a fresh one. */
  sessionFile?: string;
  /** Kept on disk for the person to reopen, as turri keeps its own chats. */
  persisted: boolean;
}

/**
 * What a front end does with turri, every member optional: given none, the session works unattended - no chats, no
 * sentinel, nobody asked.
 */
export interface Frontend {
  /** Where the person watches turri's work, in the front end's own words: told the model, which names no other view. */
  surface?: string;
  /** The front end's own pi extensions, built into every chat after turri's: its renderers, tools, commands and keys. */
  extensions?: ExtensionFactory[];
  /**
   * Put a question to the person - ask_user's, a skill's interview, a review gate's - and resolve with what they chose
   * or typed; undefined when they gave no answer. `signal` is aborted when the question is over without it - declined,
   * or its turn stopped: the front end closes it.
   */
  ask?(question: Question, context: { chat: string; signal: AbortSignal }): Promise<string | undefined>;
  /** Where the chats' pi sessions are made. Default: `{ kind: "managed" }`. */
  sessions?: ManagedSessions | ExternalSessions;
  /** The person asked to see something the front end shows - `/pulses`: true when it shows it, else the chat lists it. */
  reveal?(target: RevealTarget, context: { chat: string }): boolean;
  /**
   * A capture wrote a project of its own: open it, as the front end opens projects - asking the person first, if it
   * asks - and tell its report there (a session opened with `captured`). False leaves the report to the chat.
   */
  openProject?(dir: string, context: { summary: string; reportFile: string }): Promise<boolean>;
  /** pi's own settings, the last entry of /settings: opened where the front end has them. */
  openPiSettings?(): boolean;
  /** The last word on a chat's whole system prompt, as turri built it for the turn. */
  systemPrompt?(prompt: string, context: { chat: string }): string;
  /**
   * What the front end shows the person itself, from the events: pulse ends and the sentinel's conclusions - the chat's
   * agent is told them with no turn of its own - and notices, which a chat then never puts as a question.
   */
  shows?: { pulseEnds?: boolean; notices?: boolean };
  /** The sentinel's own tools beside turri's - a front end's browser - and where the person watches it use them. */
  sentinel?: { tools?: ToolDefinition[]; surface?: string };
}

/** A session's own values for config keys, read in its project as config.turri.yaml's: models as provider/model-id[:thinking]. */
export interface SessionOverrides {
  harnessModel?: string;
  codingModel?: string;
  judgeModel?: string;
  review?: boolean;
  mutationTesting?: boolean;
  /** Keep what turri writes for a person debugging it (logs, sessions, outputs). */
  debug?: boolean;
}

export interface TurriOptions {
  /** The front end. None: unattended. */
  frontend?: Frontend;
  /** Who runs turri - the banner shows it, the ledger and run reports record it. Default: the core. */
  client?: ClientInfo;
  /** This session's own config values, over config.turri.yaml's while it is open. */
  overrides?: SessionOverrides;
  /** Keep the open chats in .turri/chats.json, for `chats.restore("last")`. Default: with a front end. */
  persist?: boolean;
  /** pi's folder - settings, models, credentials. Default: pi's own. */
  agentDir?: string;
  /** Where managed chats' conversations are saved. Default: pi's own folder for the project. */
  sessionDir?: string;
  /** This session is opened in the project a capture wrote: its report, told in the first chat. */
  captured?: { summary: string };
  /** A listener from the moment the session opens: it hears what happens as it opens - `orphansStopped` - too. */
  onEvent?(event: TurriEvent): void;
}

/** How a capture ended, as its `captureEnded` event says. */
export type CaptureEnd = { state: "completed"; result: CaptureResult } | { state: "failed"; error: string } | { state: "stopped" };

/** Every event, by its type: plain data, safe to send across a process (structuredClone). */
export interface TurriEventMap {
  /** A chat opened, closed, renamed, or started or stopped working or asking. */
  chats: { chats: ChatInfo[] };
  /** A chat's pi session replaced under the same id - the sentinel's fresh conversation: read `chats.get(chat).session`. */
  chatSession: { chat: string };
  /** turri appended an entry to a chat, or sent it a message. */
  entry: { chat: string; entry: ChatEntry };
  /** What turri said to the person outside any transcript. */
  notification: { chat?: string; text: string; level: "info" | "warning" | "error" };
  /** A pulse started, moved on, or ended; `final` once it ended and is not run again as another. */
  job: { job: Job; final: boolean };
  /** What is planned changed, with no pulse changing. */
  plan: Record<never, never>;
  /** A launch asked for, started, or ended. */
  launch: { launch: Launch };
  /** Put to the person by the sentinel or turri - answer with `notices.answer`. */
  notice: { notice: Notice };
  /** Answered, dismissed or superseded. */
  noticeOver: { notice: Notice };
  /** The sentinel done with a pulse or a check, told in `chat`. */
  concluded: { chat: string; conclusion: Conclusion };
  /** A foreground skill's place in its phases; null when it ends. */
  skillProgress: { chat?: string; progress: SkillProgress | null };
  /** A capture's status as it runs. */
  captureProgress: { chat?: string; status: CaptureStatus };
  /** A capture ended. */
  captureEnded: { chat?: string; root: string } & CaptureEnd;
  /** A provider failing and waited out, or a turn turri ended itself. */
  incident: { text: string; event: ModelEvent };
  /** What the session has spent changed. */
  spending: { spending: SessionSpending };
  /** Something of turri's own failed - a healer, a provider, the history, the planner - said in a line. */
  failure: { what: "healer" | "provider" | "history" | "planner"; text: string };
  /** A func-id or scenario-id renamed in a module's records. */
  renamed: { what: "func-id" | "scenario-id"; from: string; to: string; spec: string };
  /** A killed turri's process groups, stopped as this session opened. */
  orphansStopped: { count: number };
}

export type TurriEventType = keyof TurriEventMap;
export type TurriEvent = { [K in TurriEventType]: { type: K } & TurriEventMap[K] }[TurriEventType];

/** One chat: a pi session with turri in it. A handle to a chat that has been closed throws `chat-closed`. */
export interface Chat {
  readonly id: string;
  info(): ChatInfo;
  /** Its pi session: prompt it, subscribe to it, abort it, set its model. */
  readonly session: AgentSession;
  /** turri's entries and messages in its current branch, in order. */
  entries(): ChatEntry[];
  /** Stop what it does now - its turn, a command, a compaction, a retry; `idle` when it does nothing. Never ends the session. */
  stop(): Promise<"stopped" | "idle">;
  /** Decline every question it asks now: the asker told the person declined, its turn going on. */
  decline(): Promise<"declined" | "none">;
}

/** What the pulses view shows: each codebase, the pulses this session ran, and those planned. */
export interface WorkStatus {
  modules: Array<ModuleStatus & { lookedAhead?: boolean }>;
  jobs: Job[];
  planned: Job[];
  /** Planning or regenerating now. */
  busy: boolean;
}

/** What to halt: a pulse, a module's planned pulses (by a planned row or the module's name), or what a launch started. */
export type HaltTarget = { pulse: string; reason?: string } | { launched: string };

export interface SkillRunOptions {
  /** The module it is about, when it is about one. */
  plainFile?: string;
  /** What it is asked to do, in words. */
  context?: string;
  /** The model it runs on. Default: the project's harness model - or its coding model, for a skill that says so. */
  model?: string;
  signal?: AbortSignal;
}

export interface SkillResult {
  ok: boolean;
  /** Each step's artifact, by its file. */
  artifacts: Record<string, string>;
  /** The last step's artifact. */
  output: string;
}

export interface Turri {
  /** The project's folder. */
  readonly cwd: string;
  /** turri for a pi session the front end makes itself (`sessions: external`, or pi's own first session): it joins as a chat. */
  readonly extension: ExtensionFactory;

  /** Hear one type of event, or all of them; returns what stops hearing - as does `signal`. */
  on<K extends TurriEventType>(type: K, listener: (event: Extract<TurriEvent, { type: K }>) => void, options?: { signal?: AbortSignal }): () => void;
  on(listener: (event: TurriEvent) => void, options?: { signal?: AbortSignal }): () => void;
  /** Every event from now on, until `signal` is aborted or the session is let go. */
  events(options?: { signal?: AbortSignal }): AsyncIterable<TurriEvent>;

  readonly chats: {
    list(): ChatInfo[];
    get(id: string): Chat | undefined;
    /** The chat the person looks at now. */
    focused(): string | undefined;
    /** The person looks at this chat now: a pulse a closed chat asked for is told there. */
    focus(id: string): Promise<void>;
    /** A fresh chat, or the saved one `sessionFile` is - focused unless `focus: false`. Needs a front end. */
    open(options?: { sessionFile?: string; title?: string; focus?: boolean }): Promise<Chat>;
    /** A pi session the front end made with `extension` in it - pi's first, one it rebuilt or forked - as a chat. */
    adopt(session: AgentSession): Chat;
    /** Reopen a run's chats - the last one that ended here, by default - except those open already. */
    restore(run?: RunRecord | "last"): Promise<Chat[]>;
    /** Closed: its turn stopped, its conversation let go - its pulses run on. */
    close(id: string): Promise<void>;
  };

  readonly work: {
    status(): WorkStatus;
    jobs(): Job[];
    job(id: string): Job | undefined;
    /** How far each module is built and conformed, and what drifted - never planning or starting anything. */
    standing(files?: string[]): ModuleStanding[];
    /** The spec map: each module's items, marked built, regenerating, planned or waiting - read at most every second. */
    map(options?: { refresh?: boolean }): MarkedPage[];
    /** Earlier sessions' pulses here, newest runs first. */
    history(options?: { runs?: number }): { jobs: Job[]; runs: RunView[]; more: number };
    /** Plan as regenerate would and hold the plan; the next pulses' prompts. Starts nothing. */
    lookAhead(plainFile: string): Promise<{ statuses: ModuleStatus[]; next: PlannedPulse[] }>;
    /** Regenerate a module's code from its spec as it is now. `chat`: the chat told when it ends. */
    regenerate(request: Partial<WorkRequest> & WorkRunOptions & { chat?: string }): Promise<{ planned: ModuleStatus[]; done: Promise<WorkResult> }>;
    /** Write and run a module's conformance tests. Refused while they are off. */
    conform(request: Partial<WorkRequest> & WorkRunOptions & { chat?: string }): Promise<{ planned: ModuleStatus[]; done: Promise<WorkResult> }>;
    /** Halt a pulse, a module's planned pulses, or what a launch started: what was halted, said. */
    halt(target: HaltTarget): Promise<string>;
  };

  readonly launches: {
    /** This session's launches, oldest first. */
    list(): Launch[];
    /** What launches started and is running now, on this machine. */
    running(): ReturnType<typeof runningLaunched>;
    /** Launch a module's code; resolves when the launch ends. */
    launch(plainFile?: string, options?: { chat?: string }): Promise<Launch>;
    /** Follow what launches started as it logs, a line at a time, until nothing runs or `signal` is aborted. */
    followLogs(onLine: (name: string, line: string) => void, options?: { signal?: AbortSignal }): Promise<void>;
  };

  readonly notices: {
    list(): Notice[];
    answer(id: string, answer: NoticeAnswer): Promise<"done" | "dismissed" | "ignored" | "refused" | "missing" | "over">;
  };

  readonly sentinel: {
    /** Ask the sentinel to check functional specs in what is launched of a module: the check's id, or why it was refused. */
    check(request: CheckRequest): { check: string } | { refused: string };
  };

  readonly settings: {
    /** A setting's value as config.turri.yaml - or `module`'s own file - has it. */
    get(key: string, options?: { module?: string }): unknown;
    /** Set a setting - undefined unsets it - as /settings does: written, and what turri fixed at its start changed now. */
    set(key: string, value: unknown, options?: { module?: string }): Promise<{ file: string; said: string }>;
    /** The values /settings offers for a setting after `typed`. */
    choices(key: string, typed?: string): string[];
    /**
     * Conformance tests turned on, as /conform does - the person's decision: `conformance-tests: true` written where the
     * module's value comes from (its own file, a required module's, else config.turri.yaml). Returns the file written.
     */
    turnOnConformanceTests(plainFile?: string): string;
  };

  readonly skills: {
    list(): Array<{ name: string; description: string }>;
    run(name: string, options?: SkillRunOptions): Promise<SkillResult>;
  };

  /** Dollars spent since the session opened. */
  spending(): SessionSpending;
  /** Every chat let go, what launches started stopped, the session's overrides cleared. Safe to call again. */
  dispose(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** The session open in this process, if one is. */
let current: Turri | undefined;

/** Open turri's session on the project in the process's working folder. One a process: a second throws `session-open`. */
export async function createTurri(options: TurriOptions = {}): Promise<Turri> {
  if (current !== undefined) throw new TurriError("session-open", "A turri session is open in this process already: dispose it first.");
  const { frontend, client, overrides, agentDir = getAgentDir(), sessionDir, captured } = options;
  const cwd = process.cwd();
  setConfigOverrides(cwd, sessionConfigOverrides(overrides));

  // The events, to every listener in the order they came, each listener's throw kept from turri.
  const listeners = new Set<(event: TurriEvent) => void>();
  if (options.onEvent !== undefined) listeners.add((event) => options.onEvent!(event));
  const emit = (event: TurriEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error), { code: "TURRI_LISTENER" });
      }
    }
  };
  const fromCore = (event: SessionEvent) => {
    switch (event.type) {
      case "agentCost":
        return emit({ type: "spending", spending: core.spending() });
      case "captureEnded": {
        const { type: _type, ...rest } = event;
        return emit({ type: "captureEnded", ...rest });
      }
      default:
        return emit(event as TurriEvent);
    }
  };

  const ask = frontend?.ask;
  const dialogsFor = ask !== undefined ? (chat: string): AskUserIO => frontendDialogs(ask, chat) : undefined;
  const host: TurriHost = {
    onEvent: fromCore,
    onJobChange: (job) => emit({ type: "job", job: snapshot(job), final: job.replacedBy === undefined && (job.status === "succeeded" || job.status === "failed" || job.status === "stopped") }),
    onPlanChange: () => emit({ type: "plan" }),
    onLaunch: (launch) => emit({ type: "launch", launch: snapshot(launch) }),
    onNotice: (notice) => emit({ type: "notice", notice: snapshot(notice) }),
    onNoticeOver: (notice) => emit({ type: "noticeOver", notice: snapshot(notice) }),
    onConcluded: ({ chat, ...conclusion }) => emit({ type: "concluded", chat, conclusion }),
    onChatSession: (chat) => emit({ type: "chatSession", chat }),
    ...(frontend?.surface !== undefined ? { surface: frontend.surface } : {}),
    ...(frontend?.systemPrompt !== undefined ? { systemPrompt: (prompt: string, chat: string) => frontend.systemPrompt!(prompt, { chat }) } : {}),
    ...(frontend?.sentinel !== undefined ? { sentinel: frontend.sentinel } : {}),
    pulseEndsShown: frontend?.shows?.pulseEnds === true,
    noticesShown: frontend?.shows?.notices === true,
    ...(frontend?.reveal !== undefined ? { reveal: frontend.reveal } : {}),
    ...(frontend?.openPiSettings !== undefined ? { openPiSettings: frontend.openPiSettings } : {}),
  };
  const core: TurriCore = createTurriCore(host, {
    mode: frontend !== undefined ? "host" : "chat",
    persist: options.persist ?? frontend !== undefined,
    ...(dialogsFor !== undefined ? { dialogs: dialogsFor } : {}),
    ...(client !== undefined ? { client } : {}),
    ...(frontend?.openProject !== undefined ? { openProject: frontend.openProject } : {}),
    ...(captured !== undefined ? { captured } : {}),
  });
  const stopLedger = onLedgerEvent((entry, project) => {
    if (resolve(project) !== cwd) return;
    if (entry.kind === "loop.renamed") emit({ type: "renamed", what: entry.what, from: entry.from, to: entry.to, spec: entry.spec });
    else if (entry.kind === "healer.failed") emit({ type: "failure", what: "healer", text: `${entry.healer}: ${entry.error}` });
    else if (entry.kind === "provider.error") emit({ type: "failure", what: "provider", text: entry.error });
    else if (entry.kind === "history.failed") emit({ type: "failure", what: "history", text: `${entry.subject}: ${entry.said}` });
    else if (entry.kind === "planner.failed") emit({ type: "failure", what: "planner", text: `${entry.step}: ${entry.error}` });
  });
  core.onChats(() => emit({ type: "chats", chats: core.chats() }));

  // turri, and the front end's own extensions after it, for every chat - the same factory pi builds into its own sessions.
  const extensions = frontend?.extensions ?? [];
  const extension: ExtensionFactory = async (pi: ExtensionAPI) => {
    // Loaded only for a person's providers (installed-providers.ts): nothing of turri starts.
    if (process.env[LOADING_PROVIDERS] === "1") return;
    await core.extension(pi);
    for (const own of extensions) await own(pi);
  };

  // Where chats live: none without a front end; else turri's own sessions, or the front end's.
  const sessions = frontend === undefined ? undefined : (frontend.sessions ?? { kind: "managed" as const });
  if (sessions?.kind === "managed") {
    core.setDriver({
      async create(chat, sessionFile) {
        const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: [core.extension, ...extensions] });
        await resourceLoader.reload();
        const sessionManager = sessionFile !== undefined ? SessionManager.open(sessionFile, sessionDir) : SessionManager.create(cwd, sessionDir);
        const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager });
        chat.session = session;
        follow(chat.id, session);
        try {
          await session.bindExtensions({ uiContext: sessions.ui?.(chat.id), mode: "tui" });
        } catch (error) {
          session.dispose();
          throw error;
        }
        // A fresh chat of the person's starts on the project's harness model; a reopened one keeps what it had.
        if (chat.role === undefined && sessionFile === undefined) await onHarnessModel(session);
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
  } else if (sessions?.kind === "external") {
    core.setDriver({
      async create(chat, sessionFile) {
        const session = await sessions.create({ chat: chat.id, ...(sessionFile !== undefined ? { sessionFile } : {}), persisted: options.persist ?? true });
        if (chat.instance === undefined) throw new TurriError("extension-not-built", "The front end's session was made without turri's extension: build Turri.extension into it before create resolves.");
        chat.session = session;
        follow(chat.id, session);
      },
      ...(sessions.show !== undefined ? { show: async (chat: ChatState) => { await sessions.show!(chat.id); core.showing(chat); } } : {}),
      async dispose(chat) {
        if (chat.session !== undefined) await sessions.release?.(chat.id, chat.session);
      },
    });
  }

  /** A chat's entries and messages, as each is appended or delivered. */
  function follow(chat: string, session: AgentSession): void {
    session.subscribe((event) => {
      // pi announces a custom entry as entry_appended but a delivered custom message as message_end.
      const entry = event.type === "entry_appended" ? event.entry : event.type === "message_end" && event.message.role === "custom"
        ? { type: "custom_message" as const, customType: event.message.customType, content: event.message.content, details: event.message.details, display: event.message.display } : undefined;
      if (entry !== undefined && isChatEntry(entry)) emit({ type: "entry", chat, entry: snapshot(entry) });
    });
  }

  /** A person's chat on the project's harness model, as the config names it - pi's own default otherwise. */
  async function onHarnessModel(session: AgentSession): Promise<void> {
    const named = splitModelSpec(modelSpec(projectModels(readProjectConfig(cwd)).harness));
    if (named.model === undefined) return;
    try {
      const slash = named.model.indexOf("/");
      const model = slash > 0 ? session.extensionRunner.createContext().modelRegistry.find(named.model.slice(0, slash), named.model.slice(slash + 1)) : undefined;
      if (model !== undefined && session.model !== model) await session.setModel(model);
      if (named.thinking !== undefined) session.setThinkingLevel(named.thinking as never);
    } catch {
      /* a model that cannot be found or switched to: the chat keeps pi's */
    }
  }

  const stateOf = (id: string): ChatState | undefined => {
    const session = core.session(id);
    return session !== undefined ? core.chatOfSession(session) : undefined;
  };
  const handle = (id: string): Chat => ({
    id,
    info() {
      const info = core.chats().find((chat) => chat.id === id);
      if (info === undefined) throw new TurriError("chat-closed", `The chat ${id} is closed.`);
      return info;
    },
    get session() {
      const session = core.session(id);
      if (session === undefined) throw new TurriError("chat-closed", `The chat ${id} is closed.`);
      return session;
    },
    entries: () => core.session(id)?.sessionManager.getBranch().filter(isChatEntry) ?? [],
    async stop() {
      const session = core.session(id);
      if (session === undefined) throw new TurriError("chat-closed", `The chat ${id} is closed.`);
      return interruptChat(session, { lastStop: 0, idle: () => "idle" as const }) === "stopped" ? "stopped" : "idle";
    },
    async decline() {
      const said = core.decline(id);
      if (said === "missing") throw new TurriError("chat-closed", `The chat ${id} is closed.`);
      return said;
    },
  });
  const chatOrThrow = (id: string): ChatState => {
    const state = stateOf(id);
    if (state === undefined) throw new TurriError("not-found", `There is no chat ${id}.`);
    return state;
  };

  const map = createSpecMapSource({ files: () => defaultMapFiles(cwd), plan: () => plannedLoop(core.jobs)?.mapPlan() ?? { files: [], codebases: [] } });
  const job = (id: string) => core.jobs.get(id);

  const work = (kind: "regenerate" | "conform") => async (request: Partial<WorkRequest> & WorkRunOptions & { chat?: string }) => {
    const { chat, ...asked } = request;
    const plainFile = resolve(cwd, asked.plainFile ?? readProjectConfig(cwd).module ?? "");
    if (asked.plainFile === undefined && readProjectConfig(cwd).module === undefined) throw new TurriError("refused", "Name the module's .plain file: config.turri.yaml names no module.");
    // Each pulse's end, as the session's events tell it - for the run's report.
    const finished = new Set<(job: Job) => void>();
    const hear = (event: TurriEvent) => {
      if (event.type === "job" && event.final) for (const each of finished) each(event.job);
    };
    listeners.add(hear);
    const stop = () => void listeners.delete(hear);
    const start = () =>
      runWork(
        {
          loop: sessionLoop(core),
          jobs: core.jobs,
          onFinish: (listener) => (finished.add(listener), () => void finished.delete(listener)),
          ...(ask !== undefined ? { ask: (title: string, body: string) => askYesNo(ask, chat ?? core.shown() ?? "", title, body) } : {}),
        },
        kind,
        { ...asked, plainFile },
      );
    try {
      const run = chat !== undefined ? await inChat(chatOrThrow(chat).scope, start) : await start();
      return { planned: run.planned, done: run.done.finally(stop) };
    } catch (error) {
      stop();
      throw error;
    }
  };

  const turri: Turri = {
    cwd,
    extension,
    on(...args: unknown[]): () => void {
      const [first, second, third] = args;
      const listener = typeof first === "function" ? (first as (event: TurriEvent) => void) : (event: TurriEvent) => { if (event.type === first) (second as (event: TurriEvent) => void)(event); };
      const { signal } = ((typeof first === "function" ? second : third) ?? {}) as { signal?: AbortSignal };
      if (signal?.aborted === true) return () => {};
      listeners.add(listener);
      const off = () => listeners.delete(listener);
      signal?.addEventListener("abort", off, { once: true });
      return off;
    },
    events(options = {}) {
      return eventStream((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }, options.signal, closed);
    },
    chats: {
      list: () => core.chats(),
      get: (id) => (core.session(id) !== undefined ? handle(id) : undefined),
      focused: () => core.shown(),
      focus: (id) => core.show(id),
      async open(asked = {}) {
        if (sessions === undefined) throw new TurriError("no-chat", "A session with no front end has no chats: open it with a frontend.");
        try {
          const info = await core.open({ ...(asked.sessionFile !== undefined ? { sessionFile: asked.sessionFile } : {}), ...(asked.title !== undefined ? { title: asked.title } : {}), ...(asked.focus === false ? { hidden: true } : {}) });
          return handle(info.id);
        } catch (error) {
          throw isTurriError(error) ? error : new TurriError(/the most there can be/.test(String(error)) ? "chat-limit" : "refused", error instanceof Error ? error.message : String(error), { cause: error });
        }
      },
      adopt: (session) => handle(core.adopt(session).id),
      async restore(run = "last") {
        const saved = run === "last" ? lastRun(cwd) : run;
        if (saved === undefined) return [];
        const before = new Set(core.chats().map((chat) => chat.id));
        await core.restore(saved);
        return core.chats().filter((chat) => !before.has(chat.id)).map((chat) => handle(chat.id));
      },
      close: (id) => core.close(id),
    },
    work: {
      status() {
        const loop = plannedLoop(core.jobs);
        const planned = loop?.planned() ?? [];
        const held = new Set(planned.filter((row) => row.lookedAhead).map((row) => row.module));
        const jobs = core.jobs.list().filter((each) => each.replacedBy === undefined);
        const busy = planned.some((row) => row.planning !== undefined) || jobs.some((each) => each.status === "running" && (each.kind === "regenerate" || each.kind === "conformance"));
        return snapshot({ modules: (loop?.status() ?? []).map((row) => (held.has(row.module) ? { ...row, lookedAhead: true } : row)), jobs, planned, busy });
      },
      jobs: () => snapshot(core.jobs.list()),
      job: (id) => { const found = job(id); return found !== undefined ? snapshot(found) : undefined; },
      standing: (files) => projectStanding(cwd, { ...(files !== undefined ? { files } : {}), loop: plannedLoop(core.jobs) }),
      map(asked = {}) {
        if (asked.refresh === true) map.refresh();
        return map.read();
      },
      history(asked = {}) {
        return earlierPulses(ledgerProjects(cwd), new Set(core.jobs.list().map((each) => each.id)), asked.runs);
      },
      async lookAhead(plainFile) {
        const loop = sessionLoop(core);
        const statuses = await lookAhead(loop, resolve(cwd, plainFile));
        const next: PlannedPulse[] = [];
        for await (const pulse of nextPulses(loop, statuses)) next.push(pulse);
        return { statuses, next };
      },
      regenerate: work("regenerate"),
      conform: work("conform"),
      async halt(target) {
        if ("pulse" in target) return stopJob(core.jobs, target.pulse, target.reason, plannedLoop(core.jobs));
        return haltLaunched(target.launched, sessionLaunchesOf(core.jobs)?.track);
      },
    },
    launches: {
      list: () => snapshot(sessionLaunchesOf(core.jobs)?.track.list() ?? []),
      running: () => runningLaunched(),
      async launch(plainFile, asked = {}) {
        const track = sessionLaunchesOf(core.jobs)?.track;
        const file = plainFile ?? readProjectConfig(cwd).module;
        if (track === undefined || file === undefined) throw new TurriError("refused", "Name the module's .plain file: config.turri.yaml names no module.");
        const { launch, already } = track.request({ plainFile: resolve(cwd, file), cause: asked.chat !== undefined ? { chat: asked.chat } : {} });
        return snapshot(already ? launch : await track.done(launch.id));
      },
      followLogs: (onLine, asked = {}) => followLaunchedLogs(onLine, asked.signal !== undefined ? { signal: asked.signal } : {}),
    },
    notices: {
      list: () => snapshot(core.notices()),
      answer: async (id, answer) => core.answer(id, answer),
    },
    sentinel: {
      check: (request) => core.check(() => prepareCheck(cwd, request)),
    },
    settings: {
      get(key, asked = {}) {
        return currentValue(asked.module !== undefined ? readModuleConfigText(cwd, asked.module) : readConfigText(cwd), key);
      },
      async set(key, value, asked = {}) {
        return setSetting(core, key, value, asked.module, reachableModels);
      },
      choices(key, typed = "") {
        const setting = settingOf(key, ruleNames());
        if (setting === undefined) return [];
        return settingCandidates(setting, typed, { cwd, models: reachableModels });
      },
      turnOnConformanceTests: (plainFile) => turnOnConformance(core, plainFile),
    },
    skills: {
      list: () => discoverSkills(PACKAGE_ROOT, cwd).skills.map((skill) => ({ name: skill.name, description: skill.description })),
      run: (name, asked = {}) => runNamedSkill(core, name, asked, ask, (progress) => emit({ type: "skillProgress", progress })),
    },
    spending: () => core.spending(),
    async dispose() {
      if (disposed) return;
      disposed = true;
      closed.abort();
      stopLedger();
      await core.dispose();
      await stopLaunched();
      setConfigOverrides(cwd, undefined);
      listeners.clear();
      if (current === turri) current = undefined;
    },
    [Symbol.asyncDispose]: () => turri.dispose(),
  };
  let disposed = false;
  const closed = new AbortController();

  /** The models of every provider signed in to, from a chat's own registry - the one shown, else any open. */
  function reachableModels(): string[] {
    for (const id of [core.shown(), ...core.chats().map((chat) => chat.id)]) {
      try {
        const context = id !== undefined ? stateOf(id)?.instance?.context() : undefined;
        if (context !== undefined) return reachable(context);
      } catch {
        /* a context let go: the next one */
      }
    }
    return [];
  }

  current = turri;
  return turri;
}

/** The session's overrides as the config's keys. */
function sessionConfigOverrides(overrides: SessionOverrides | undefined): ConfigOverrides | undefined {
  if (overrides === undefined) return undefined;
  const model = (spec: string | undefined) => (spec !== undefined ? splitModelSpec(spec) : undefined);
  return {
    ...(overrides.harnessModel !== undefined ? { harnessModel: model(overrides.harnessModel) } : {}),
    ...(overrides.codingModel !== undefined ? { codingModel: model(overrides.codingModel) } : {}),
    ...(overrides.judgeModel !== undefined ? { judgeModel: model(overrides.judgeModel) } : {}),
    ...(overrides.review !== undefined ? { review: overrides.review } : {}),
    ...(overrides.mutationTesting !== undefined ? { mutationTesting: overrides.mutationTesting } : {}),
    ...(overrides.debug !== undefined ? { debug: overrides.debug } : {}),
  } as ConfigOverrides;
}

/** The front end's `ask` as the dialogs turri's questions are put in, for one chat. */
function frontendDialogs(ask: NonNullable<Frontend["ask"]>, chat: string): AskUserIO {
  const signalOf = (asked: DialogAsked | undefined) => asked?.signal ?? new AbortController().signal;
  return {
    select: (title, options, context, at, asked) => ask({ kind: "select", title, options, ...(context !== undefined ? { context } : {}), ...(at !== undefined ? { at } : {}) }, { chat, signal: signalOf(asked) }),
    input: (title, context, asked) => ask({ kind: "input", title, ...(context !== undefined ? { context } : {}) }, { chat, signal: signalOf(asked) }),
  };
}

const YES = "Yes";

/** A yes or no put to the person through the front end: true for yes; undefined when they gave no answer. */
async function askYesNo(ask: NonNullable<Frontend["ask"]>, chat: string, title: string, body: string): Promise<boolean | undefined> {
  const answer = await ask({ kind: "select", title, options: [YES, "No"], context: body }, { chat, signal: new AbortController().signal });
  return answer === undefined ? undefined : answer === YES;
}

/** Plain data of what turri keeps live: a copy a front end may keep, send or change. */
function snapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/** The events from now on as an async iterable, until `signal` or `closed` is aborted. */
function eventStream(subscribe: (listener: (event: TurriEvent) => void) => () => void, signal: AbortSignal | undefined, closed: AbortController): AsyncIterable<TurriEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queue: TurriEvent[] = [];
      let wake: (() => void) | undefined;
      let ended = false;
      const unsubscribe = subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      const end = () => {
        ended = true;
        unsubscribe();
        wake?.();
      };
      signal?.addEventListener("abort", end, { once: true });
      closed.signal.addEventListener("abort", end, { once: true });
      if (signal?.aborted === true || closed.signal.aborted) end();
      return {
        async next(): Promise<IteratorResult<TurriEvent>> {
          while (queue.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve));
          wake = undefined;
          const event = queue.shift();
          return event !== undefined ? { value: event, done: false } : { value: undefined, done: true };
        },
        async return(): Promise<IteratorResult<TurriEvent>> {
          end();
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/** A setting written as /settings writes it, and what turri fixed at its start changed now. */
async function setSetting(core: TurriCore, key: string, value: unknown, module: string | undefined, models: () => string[]): Promise<{ file: string; said: string }> {
  const { cwd } = core;
  const setting = settingOf(key, ruleNames());
  if (setting === undefined) throw new TurriError("not-found", `There is no setting ${key}.`);
  if (value !== undefined) {
    const typed = Array.isArray(value) ? value.join(", ") : String(value);
    const known = models();
    const parsed = parseValue(setting, typed, known.length > 0 ? (model) => known.includes(model) : undefined);
    if ("error" in parsed) throw new TurriError("refused", parsed.error);
    if ("value" in parsed) value = parsed.value;
  }
  const text = writeSetting(cwd, setting.key, value, module);
  const file = module !== undefined ? `config.turri.${module}.yaml` : "config.turri.yaml";
  const notes: string[] = [];
  // A model changed: the AWS region its Bedrock models need worked out again.
  if (setting.key.endsWith("-model") || setting.key.startsWith("models.")) applyBedrockRegion(cwd);
  // The session's own coding model gives way to the file's.
  if (setting.key === "coding-model" || setting.key === "models.coding" || setting.key === "models.default") dropConfigOverride(cwd, "codingModel");
  if (setting.key === "harness-model" || setting.key === "models.chat") dropConfigOverride(cwd, "harnessModel");
  if (setting.key === "parallel-jobs") core.jobs.setMaxRunning(parallelJobs(cwd));
  notes.push(...overriddenBy(cwd, text, setting, module));
  const what = value === undefined ? `${setting.key} unset` : `${setting.key}: ${shownValue(value)}`;
  return { file, said: [`${what} - written to ${file}, ${EFFECT_TEXT[setting.effect]}.`, ...notes].join("\n") };
}

/** A skill run outside any chat: its questions and escalations put through the front end, its progress as events. */
async function runNamedSkill(core: TurriCore, name: string, options: SkillRunOptions, ask: Frontend["ask"], progress: (progress: SkillProgress | null) => void): Promise<SkillResult> {
  const { cwd } = core;
  const skill = discoverSkills(PACKAGE_ROOT, cwd).skills.find((each) => each.name === name);
  if (skill === undefined) throw new TurriError("not-found", `There is no skill ${name}.`);
  const phases = skill.steps.map((step) => step.name);
  const models = projectModels(readProjectConfig(cwd));
  const model = options.model ?? modelSpec(skill.model === "coding" ? models.coding : models.harness);
  const io = ask !== undefined ? frontendDialogs(ask, "") : undefined;
  progress({ skill: skill.name, phases, current: -1, attempt: 1 });
  try {
    const result = await runSkill({
      skillDir: skill.dir,
      cwd,
      runDir: skillRunDir(cwd, skill.name),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
      ...(model !== undefined ? { model } : {}),
      renderQueue: sessionLoop(core),
      report: {
        step: (step, attempt) => progress({ skill: skill.name, phases, current: phases.indexOf(step), attempt }),
        artifact: () => {},
        gate: () => {},
        judge: () => {},
        outcome: () => {},
      },
      ...(io !== undefined ? { askUser: (request) => runAsk(request, io) } : {}),
      escalate: async ({ question, critique }) => (ask !== undefined ? (await askYesNo(ask, "", `Review gate: ${skill.name} - ${question}`, critique)) === true : false),
    });
    return { ok: result.ok, artifacts: result.artifacts, output: result.output };
  } finally {
    progress(null);
  }
}

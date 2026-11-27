import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type AgentSession, type ExtensionAPI, type ExtensionFactory, type ExtensionUIContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { runAsk, type AskUserIO, type DialogAsked } from "./ask.ts";
import { inChat } from "./chat-scope.ts";
import { isChatEntry, type ChatEntry } from "./chat-entries.ts";
import type { ModelOutOfReach } from "./chat-model.ts";
import { lastRun, type RunRecord } from "./chat-records.ts";
import { interruptChat, type ChatInfo, type ChatState, type TurriCore, type TurriHost } from "./chats.ts";
import type { ClientInfo } from "./client.ts";
import { modelSpec, projectModels, readProjectConfig, setConfigOverrides, splitModelSpec, type ConfigOverrides } from "./config.ts";
import { readSetting, settingOf, type SettingKey, type SettingValues } from "./config-edit.ts";
import { createTurriCore, parallelJobs, plannedLoop, sessionLaunchesOf, sessionLoop, turnOnConformance } from "./extension.ts";
import { PACKAGE_ROOT } from "./environment.ts";
import { isTurriError, TurriError } from "./errors.ts";
import { runSkill } from "./genome.ts";
import { LOADING_PROVIDERS } from "./installed-providers.ts";
import { haltLaunched, stopJob } from "./loop-tools.ts";
import { lookAhead, nextPulses } from "./preview.ts";
import { describeTurnIncident, type ModelEvent } from "./regenerate/activity.ts";
import type { Job } from "./regenerate/jobs.ts";
import { followLaunchedLogs, runningLaunched, stopLaunched, type LaunchedProcess } from "./regenerate/launch.ts";
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
import { changeSetting, givenValue, reachable, ruleNames, settingCandidates } from "./settings.ts";
import { discoverSkills } from "./skills.ts";
import { loadSkill, type Skill } from "./skill.ts";
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

/**
 * The front end has no chats: it answers turri's questions (`ask`) and shows what it does from the events - a command
 * run at a terminal. No chat opens (`chats.open` is refused with `no-chat`), so neither does the sentinel.
 */
export interface NoSessions {
  kind: "none";
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
   * or typed; undefined when they gave no answer. `chat` is the chat that asks, none for a question outside any chat - a
   * skill's run or a start over asked of `skills.run` or `work`. `signal` is aborted when the question is over without
   * an answer - declined, or its turn stopped: the front end closes it.
   */
  ask?(question: Question, context: { chat?: string; signal: AbortSignal }): Promise<string | undefined>;
  /** Where the chats' pi sessions are made - none, for a front end with no chats. Default: `{ kind: "managed" }`. */
  sessions?: ManagedSessions | ExternalSessions | NoSessions;
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
   * agent is told them with no turn of its own - notices, which a chat then never puts as a question, and the spec map,
   * which the session then watches, sending `map` as it changes.
   */
  shows?: { pulseEnds?: boolean; notices?: boolean; map?: boolean };
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
  /** A launch's agent said more, as it streams: `text` follows what it said before. */
  launchOutput: { launch: string; codebase: string; text: string };
  /** The spec map changed - sent while the front end shows it (`shows.map`). */
  map: { pages: MarkedPage[] };
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
  /** A person's chat cannot be on harness-model now - and sends nothing to a model - or, null, it can again. */
  outOfReach: { chat: string; outOfReach: ModelOutOfReach | null };
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
  /**
   * harness-model as this chat cannot be on it now - no such model here, or its provider not signed in: while it cannot,
   * the chat sends nothing to a model. None while it is on it, or for the sentinel's chat.
   */
  outOfReach(): ModelOutOfReach | undefined;
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

/** How a launch is asked for, and what it tells as it runs. */
export interface LaunchOptions {
  /** The chat told when it ends. */
  chat?: string;
  /** How this project launches it, as the person said it - kept for the codebase's launches after it. */
  guidance?: string;
  /** The codebase to take, when modules built on this one branch. */
  inModule?: string;
  /** Launch it even when its code is out already. */
  again?: boolean;
  /** The launch agent's words as they stream - this launch's, and the one that took its place. */
  onOutput?(text: string): void;
  /** Stops the launch - and what it started - while it is under way. */
  signal?: AbortSignal;
}

export interface SkillRunOptions {
  /** The module it is about, when it is about one. */
  plainFile?: string;
  /** What it is asked to do, in words. */
  context?: string;
  /** The model it runs on. Default: the project's harness model - or its coding model, for a skill that says so. */
  model?: string;
  signal?: AbortSignal;
  /** What the run says as it goes - each step tried, what it left, each gate's review and decision - as it says it. */
  onReport?(report: SkillReport): void;
}

/** A skill: its name, what it is for, and its steps - each with the review gate after it, if it has one. */
export interface SkillInfo {
  name: string;
  description: string;
  steps: SkillStep[];
}

export interface SkillStep {
  name: string;
  /** What the step does, in a short line for the person. */
  about?: string;
  gate?: SkillGate;
}

/** The review a step's work passes before the skill goes on. */
export interface SkillGate {
  /** The rubric the judges hold the work to: its file, in the skill's folder. */
  rubric: string;
  /** Independent judges, each in a session of its own. */
  judges: number;
  /** How many of them must pass the work. */
  quorum: "all" | "majority" | "any";
  /** What a review the work fails does: the step tried again, the person asked, or the run ended. */
  onFail: "retry" | "escalate" | "abort";
  /** How many times the step is tried again before `onFail` gives up on it. */
  maxRetries: number;
  /** A reviewer reading along as the step works, its findings settled before the judges are asked. */
  continuous?: { rubric: string; judges: number };
}

/** What a skill's run says as it goes, in order. */
export type SkillReport =
  /** It starts: the skill, and its steps and gates. */
  | { kind: "start"; skill: string; steps: SkillStep[] }
  /** A step tried - again, after its gate sent it back, from attempt 2. */
  | { kind: "step"; step: string; attempt: number }
  /** What the step left, by its file in the run's folder. */
  | { kind: "artifact"; step: string; path: string; body: string }
  /** One pass of the reviewer reading along: what it read, and how many findings it left to fix. */
  | { kind: "livePass"; step: string; scope: string; findings: number }
  /** The reviewer reading along, at the gate: its passes, and the findings still open - any fail the gate at once. */
  | { kind: "liveReview"; step: string; passes: number; findings: number }
  /** The gate reviews the step's work with this many judges - none when there is no work to review: it fails. */
  | { kind: "gate"; step: string; judges: number }
  /** One judge's verdict - `none` when it gave none, which counts as a fail - and how many violations it found. */
  | { kind: "judge"; step: string; judge: number; model: string; verdict: "pass" | "fail" | "none"; violations: number }
  /** The gate's decision, and the critique it sends the step back with. */
  | { kind: "outcome"; step: string; decision: "advance" | "retry" | "escalate" | "abort"; critique: string };

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
    /**
     * Each of the person's chats put on harness-model as the config has it now, where it can be: after the person signed
     * in to a provider, or changed harness-model outside turri. A chat checks it again as it is sent something, too.
     */
    onHarnessModel(): Promise<void>;
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
    running(): LaunchedProcess[];
    /**
     * Launch a module's code - the config's module, none named - and resolve when the launch ends: or, superseded by a
     * newer one as it waited, when that one ends. Already out, it resolves with the launch that put it out.
     */
    launch(plainFile?: string, options?: LaunchOptions): Promise<Launch>;
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
    /**
     * A setting's value as config.turri.yaml - or `module`'s own file - has it; undefined when unset there. One the file
     * has that its kind cannot take throws `config-invalid`.
     */
    get<K extends SettingKey>(key: K, options?: { module?: string }): SettingValues[K] | undefined;
    /**
     * Set a setting - undefined unsets it - as /settings does: checked (`refused`, with why), written, and what turri
     * fixed at its start changed now. `said` is what changed and when it takes effect, in a line or more.
     */
    set<K extends SettingKey>(key: K, value: SettingValues[K] | undefined, options?: { module?: string }): Promise<{ file: string; said: string }>;
    /** The values /settings offers for a setting after `typed`. */
    choices(key: SettingKey, typed?: string): string[];
    /**
     * Conformance tests turned on, as /conform does - the person's decision: `conformance-tests: true` written where the
     * module's value comes from (its own file, a required module's, else config.turri.yaml). Returns the file written.
     */
    turnOnConformanceTests(plainFile?: string): string;
  };

  readonly skills: {
    /** turri's own skills and the project's, each with its steps and gates. */
    list(): SkillInfo[];
    /**
     * Run a skill outside any chat: one by name - turri's own or the project's, as `list` has them - or the skill in a
     * folder with a SKILL.md (`{ dir }`, from the project's folder). One there is none of is `not-found`; a SKILL.md that
     * does not parse, `refused` with why.
     */
    run(skill: string | { dir: string }, options?: SkillRunOptions): Promise<SkillResult>;
  };

  /** Dollars spent since the session opened. */
  spending(): SessionSpending;
  /** Every chat let go, what launches started stopped, the session's overrides cleared. Safe to call again. */
  dispose(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** How often a shown spec map's files are looked at for a change. */
const MAP_EVERY_MS = 1000;

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
        listenerThrew(error);
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

  let disposed = false;
  const closed = new AbortController();
  const map = createSpecMapSource({ files: () => defaultMapFiles(cwd), plan: () => plannedLoop(core.jobs)?.mapPlan() ?? { files: [], codebases: [] } });
  // The spec map, watched while the front end shows it: sent as it changes - its files looked at each second, and the
  // marks laid again as the work moves.
  let mapShown = "";
  let mapSoon: ReturnType<typeof setTimeout> | undefined;
  const sendMap = () => {
    mapSoon = undefined;
    if (disposed) return;
    const pages = map.read();
    const print = JSON.stringify(pages);
    if (print === mapShown) return;
    mapShown = print;
    emit({ type: "map", pages: snapshot(pages) });
  };
  const mapTimer = frontend?.shows?.map === true ? setInterval(sendMap, MAP_EVERY_MS) : undefined;
  mapTimer?.unref();

  // Where chats live: none without a front end, or with one that has none; else turri's own sessions, or the front end's.
  const given = frontend === undefined ? undefined : (frontend.sessions ?? { kind: "managed" as const });
  const sessions = given?.kind === "none" ? undefined : given;
  const ask = frontend?.ask;
  const dialogsFor = ask !== undefined ? (chat: string): AskUserIO => frontendDialogs(ask, chat) : undefined;
  const host: TurriHost = {
    onEvent: fromCore,
    onJobChange: (job) => {
      emit({ type: "job", job: snapshot(job), final: job.replacedBy === undefined && (job.status === "succeeded" || job.status === "failed" || job.status === "stopped") });
      mapMoved();
    },
    onPlanChange: () => {
      emit({ type: "plan" });
      mapMoved();
    },
    onLaunch: (launch) => emit({ type: "launch", launch: snapshot(launch) }),
    onLaunchOutput: (launch, text) => emit({ type: "launchOutput", launch: launch.id, codebase: launch.codebase, text }),
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
    persist: options.persist ?? sessions !== undefined,
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

  /** The work moved: the map, while it is shown, marked again and sent if that changed it - once for a burst of changes. */
  function mapMoved(): void {
    if (frontend?.shows?.map !== true || disposed || mapSoon !== undefined) return;
    map.remark();
    mapSoon = setTimeout(sendMap, 50);
    mapSoon.unref();
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
    outOfReach() {
      if (core.session(id) === undefined) throw new TurriError("chat-closed", `The chat ${id} is closed.`);
      const outOfReach = core.outOfReach(id);
      return outOfReach !== undefined ? snapshot(outOfReach) : undefined;
    },
  });
  const chatOrThrow = (id: string): ChatState => {
    const state = stateOf(id);
    if (state === undefined) throw new TurriError("not-found", `There is no chat ${id}.`);
    return state;
  };

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
          ...(ask !== undefined ? { ask: (title: string, body: string) => askYesNo(ask, chat ?? core.shown(), title, body) } : {}),
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
        if (sessions === undefined) throw new TurriError("no-chat", frontend === undefined ? "A session with no front end has no chats: open it with a frontend." : "This front end has no chats (sessions: none).");
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
      onHarnessModel: () => core.onHarnessModel(),
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
        if (file === undefined) throw new TurriError("refused", "Name the module's .plain file: config.turri.yaml names no module.");
        if (track === undefined) throw new TurriError("refused", "This session has no launch track.");
        if (asked.signal?.aborted === true) throw new TurriError("aborted", "The launch was stopped before it was asked for.");
        let request: ReturnType<typeof track.request>;
        try {
          request = track.request({
            plainFile: resolve(cwd, file),
            cause: asked.chat !== undefined ? { chat: asked.chat } : {},
            ...(asked.guidance !== undefined ? { guidance: asked.guidance } : {}),
            ...(asked.inModule !== undefined ? { inModule: asked.inModule } : {}),
            ...(asked.again === true ? { again: true } : {}),
          });
        } catch (error) {
          throw new TurriError("refused", error instanceof Error ? error.message : String(error), { cause: error });
        }
        const { launch, already } = request;
        if (already) return snapshot(launch);
        // Its output, and the output of each launch that takes its place, to `onOutput` - until it ends.
        const ours = new Set([launch.id]);
        const follow = (id: string): void => void track.replaced(id).then((next) => (ours.add(next.id), follow(next.id)));
        follow(launch.id);
        const onOutput = asked.onOutput;
        const off = onOutput !== undefined ? turri.on("launchOutput", (event) => { if (ours.has(event.launch)) onOutput(event.text); }) : () => {};
        const stop = () => void track.stop(launch.codebase);
        asked.signal?.addEventListener("abort", stop, { once: true });
        try {
          return snapshot(await track.done(launch.id));
        } finally {
          off();
          asked.signal?.removeEventListener("abort", stop);
        }
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
      get: (key, asked = {}) => readSetting(cwd, key, asked),
      async set(key, value, asked = {}) {
        const setting = settingOf(key, ruleNames());
        if (setting === undefined) throw new TurriError("not-found", `There is no setting ${String(key)}.`);
        if (asked.module !== undefined && setting.projectOnly === true) throw new TurriError("refused", `${setting.key} is the whole project's: it is set in config.turri.yaml alone, never in a module's file.`);
        const known = reachableModels();
        const written = givenValue(cwd, setting, value, known.length > 0 ? (model) => known.includes(model) : undefined);
        return changeSetting(cwd, setting, written, asked.module, {
          harnessChanged: () => core.onHarnessModel(),
          parallelJobs: (count) => {
            const limit = count ?? parallelJobs(cwd);
            core.jobs.setMaxRunning(limit);
            return `Up to ${limit} pulse${limit === 1 ? "" : "s"} run at once now.`;
          },
        });
      },
      choices(key, typed = "") {
        const setting = settingOf(key, ruleNames());
        if (setting === undefined) return [];
        return settingCandidates(setting, typed, { cwd, models: reachableModels });
      },
      turnOnConformanceTests: (plainFile) => turnOnConformance(core, plainFile),
    },
    skills: {
      list: () => discoverSkills(PACKAGE_ROOT, cwd).skills.map((skill) => ({ name: skill.name, description: skill.description, steps: stepsOf(skill) })),
      run: (which, asked = {}) => runSkillOutsideChats(core, which, asked, ask, (progress) => emit({ type: "skillProgress", progress })),
    },
    spending: () => core.spending(),
    async dispose() {
      if (disposed) return;
      disposed = true;
      closed.abort();
      if (mapTimer !== undefined) clearInterval(mapTimer);
      if (mapSoon !== undefined) clearTimeout(mapSoon);
      stopLedger();
      await core.dispose();
      await stopLaunched();
      setConfigOverrides(cwd, undefined);
      listeners.clear();
      if (current === turri) current = undefined;
    },
    [Symbol.asyncDispose]: () => turri.dispose(),
  };

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

/**
 * A front end's listener threw: a warning coded `TURRI_LISTENER`, its stack the detail - never turri's own error. Given
 * an Error, Node drops the code, so the warning is the message.
 */
function listenerThrew(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.emitWarning(message, { code: "TURRI_LISTENER", ...(error instanceof Error && error.stack !== undefined ? { detail: error.stack } : {}) });
}

/** The front end's `ask` as the dialogs turri's questions are put in, for one chat - or none, outside any. */
function frontendDialogs(ask: NonNullable<Frontend["ask"]>, chat: string | undefined): AskUserIO {
  const asking = (asked: DialogAsked | undefined) => ({ ...(chat !== undefined ? { chat } : {}), signal: asked?.signal ?? new AbortController().signal });
  return {
    select: (title, options, context, at, asked) => ask({ kind: "select", title, options, ...(context !== undefined ? { context } : {}), ...(at !== undefined ? { at } : {}) }, asking(asked)),
    input: (title, context, asked) => ask({ kind: "input", title, ...(context !== undefined ? { context } : {}) }, asking(asked)),
  };
}

const YES = "Yes";

/** A yes or no put to the person through the front end: true for yes; undefined when they gave no answer. */
async function askYesNo(ask: NonNullable<Frontend["ask"]>, chat: string | undefined, title: string, body: string): Promise<boolean | undefined> {
  const answer = await ask({ kind: "select", title, options: [YES, "No"], context: body }, { ...(chat !== undefined ? { chat } : {}), signal: new AbortController().signal });
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

/** A skill's steps, each with its gate, as a front end shows them. */
function stepsOf(skill: Skill): SkillStep[] {
  return skill.steps.map((step): SkillStep => {
    const gate = step.gate;
    const review = gate?.review;
    return {
      name: step.name,
      ...(step.about !== undefined ? { about: step.about } : {}),
      ...(review !== undefined
        ? {
            gate: {
              rubric: review.rubric,
              judges: review.judges,
              quorum: review.quorum,
              onFail: review.onFail,
              maxRetries: review.maxRetries,
              ...(gate!.continuous !== undefined ? { continuous: { rubric: gate!.continuous.rubric, judges: gate!.continuous.judges } } : {}),
            },
          }
        : {}),
    };
  });
}

/** The skill `skills.run` is asked for: one of the catalogue's by name, or the one in a folder. */
function skillAsked(cwd: string, which: string | { dir: string }): Skill {
  if (typeof which === "string") {
    const skill = discoverSkills(PACKAGE_ROOT, cwd).skills.find((each) => each.name === which);
    if (skill === undefined) throw new TurriError("not-found", `There is no skill ${which}.`);
    return skill;
  }
  const dir = resolve(cwd, which.dir);
  if (!existsSync(join(dir, "SKILL.md"))) throw new TurriError("not-found", `There is no SKILL.md in ${dir}.`);
  try {
    return loadSkill(dir);
  } catch (error) {
    throw new TurriError("refused", error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/** A skill run outside any chat: its questions and escalations put through the front end, its progress as events. */
async function runSkillOutsideChats(core: TurriCore, which: string | { dir: string }, options: SkillRunOptions, ask: Frontend["ask"], progress: (progress: SkillProgress | null) => void): Promise<SkillResult> {
  const { cwd } = core;
  const skill = skillAsked(cwd, which);
  const phases = skill.steps.map((step) => step.name);
  const models = projectModels(readProjectConfig(cwd));
  const model = options.model ?? modelSpec(skill.model === "coding" ? models.coding : models.harness);
  const io = ask !== undefined ? frontendDialogs(ask, undefined) : undefined;
  // What the run says, to the caller as it says it: a caller's throw is a warning, never the run's end.
  const tell = (report: SkillReport) => {
    try {
      options.onReport?.(report);
    } catch (error) {
      listenerThrew(error);
    }
  };
  // A step's artifact comes as it ends, and the judges' verdicts after the gate that asked them: the last step's, the last gate's.
  let stepping = "";
  let gating = "";
  progress({ skill: skill.name, phases, current: -1, attempt: 1 });
  tell({ kind: "start", skill: skill.name, steps: stepsOf(skill) });
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
        step: (step, attempt) => {
          stepping = step;
          progress({ skill: skill.name, phases, current: phases.indexOf(step), attempt });
          tell({ kind: "step", step, attempt });
        },
        artifact: (path, body) => tell({ kind: "artifact", step: stepping, path, body }),
        livePass: (step, scope, findings) => tell({ kind: "livePass", step, scope, findings }),
        liveReview: (step, passes, findings) => tell({ kind: "liveReview", step, passes, findings }),
        gate: (step, judges) => {
          gating = step;
          tell({ kind: "gate", step, judges });
        },
        judge: (index, model, verdict, violations) => tell({ kind: "judge", step: gating, judge: index, model, verdict: verdict === "pass" || verdict === "fail" ? verdict : "none", violations }),
        outcome: (step, decision, critique) => tell({ kind: "outcome", step, decision, critique }),
      },
      ...(io !== undefined ? { askUser: (request) => runAsk(request, io) } : {}),
      escalate: async ({ question, critique }) => (ask !== undefined ? (await askYesNo(ask, undefined, `Review gate: ${skill.name} - ${question}`, critique)) === true : false),
    });
    return { ok: result.ok, artifacts: result.artifacts, output: result.output };
  } finally {
    progress(null);
  }
}

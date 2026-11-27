import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ConfigLine } from "./config.ts";
import type { SandboxSummary } from "./regenerate/os-sandbox.ts";
import type { CustomMessageEntry, ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Notice, Conclusion } from "./notice.ts";
import type { Job } from "./regenerate/jobs.ts";
import type { LaunchStatus } from "./launch-track.ts";
import type { ScriptKind } from "./regenerate/test-scripts.ts";

/**
 * What turri keeps in a chat besides its messages: the custom entries it appends, and the custom messages it sends that
 * a front-end draws - their types and the data each carries. The core appends them; the terminal draws them, and a host
 * reads them (turri-app). A type or a field renamed here is renamed for both.
 */

/** What a slash command showed the person - an entry - and what the conversation is told of it, unseen - a message. */
export const COMMAND_OUTCOME = "turri_command_outcome";

export interface CommandOutcome {
  command: string;
  /** None: the command itself, as the person typed it. */
  text?: string;
  level?: "info" | "warning" | "error";
  echoed?: boolean;
}

/** A side question (/btw) and its answer: `{ question, answer }`. */
export const SIDE_ENTRY = "turri_btw";
/** A message the person sent while a skill ran in the chat, read by the skill's agent: drawn as the message it is. */
export const SKILL_MESSAGE_ENTRY = "turri_skill_message";

export const MILESTONE_ENTRY = "turri_milestone";
/** A newer turri out: appended by an earlier turri, and still in the chats it saved. */
export const VERSION_ENTRY = "turri_version";
export const JOB_ENTRY = "turri_job";
export const JOBS_LIST_ENTRY = "turri_jobs";
export const HISTORY_ENTRY = "turri_history";
/** The banner at the top of a chat: `BannerData`. */
export const BANNER_ENTRY = "turri_banner";

export interface JobAnnouncement {
  id: string;
  summary: string;
  status: "succeeded" | "failed" | "stopped";
  /** The job ran to its end, and what it built did not pass - a build that stopped at a gate. */
  incomplete?: boolean;
  duration: string;
  /** Tokens and cost, when any were spent. */
  spent?: string;
  text: string;
}

export const INTERVIEW_ENTRY = "turri_exchange";

export interface Exchange {
  skill: string;
  /** What the skill's agent said before asking - a brief to confirm, the choices it weighed: shown in the dialog, kept here. */
  said?: string;
  question: string;
  answer: string;
}

/** What the banner says, appended once a chat. */
export interface BannerData {
  /** Who runs turri: the session's front end as it named itself, else the core. Absent in an earlier turri's banner. */
  name?: string;
  version: string;
  /** The commit, when it runs from a clone - and whether the clone has changes on it. */
  commit?: string;
  changed?: boolean;
  /** How many skills failed to load. */
  pending: number;
  sandbox?: SandboxSummary;
  /** An earlier turri's: a newer turri out, or one hidden behind it on the PATH, a line each. */
  versions?: string[];
  /** What turri says of the config files: a key it renamed in one, an old name left, keys it does not read. */
  config?: ConfigLine[];
}

export const NOTICE_ENTRY = "turri_notice";
export const NOTICE_OVER_ENTRY = "turri_notice_over";
export const CONCLUDED_ENTRY = "turri_sentinel_concluded";
export const SKILL_RUN_ENTRY = "turri_skill_run";
export const SKILL_REPORT_ENTRY = "turri_skill_report";

/** Messages turri sends a chat's agent, unseen by the person: a spec conflict a conformance run found, to decide. */
export const SPEC_CONFLICT_MESSAGE = "turri_spec_conflict";
/** The sentinel briefed on a pulse, in a conversation of its own. */
export const SENTINEL_PULSE_MESSAGE = "turri_sentinel_pulse";
/** The sentinel asked to check functional specs in what is launched. */
export const SENTINEL_CHECK_MESSAGE = "turri_sentinel_check";
/** The sentinel's check, paused while its codebase was launched again, carried on. */
export const SENTINEL_RESUME_MESSAGE = "turri_sentinel_resume";
/** A pulse landed, told to the chat the person is in while the sentinel has it. */
export const JOB_LANDED_MESSAGE = "turri_job_landed";
/** A notice the person answered with something to do: the task. */
export const NOTICE_ANSWER_MESSAGE = "turri_notice_answer";
/** A launch this chat is to hear of ended. */
export const LAUNCH_MESSAGE = "turri_launch";

/** Each custom entry turri appends to a chat, by its `customType`: the data it carries. */
export interface ChatEntryMap {
  [BANNER_ENTRY]: BannerData;
  [VERSION_ENTRY]: { text: string };
  [COMMAND_OUTCOME]: CommandOutcome;
  [SIDE_ENTRY]: { question: string; answer: string };
  [SKILL_MESSAGE_ENTRY]: { text: string; skill: string };
  [INTERVIEW_ENTRY]: Exchange;
  [JOB_ENTRY]: JobAnnouncement;
  [HISTORY_ENTRY]: { module: string; text: string };
  [MILESTONE_ENTRY]: { module: string; text: string };
  [JOBS_LIST_ENTRY]: { text: string };
  [NOTICE_ENTRY]: Notice;
  [NOTICE_OVER_ENTRY]: Pick<Notice, "state" | "summary">;
  [CONCLUDED_ENTRY]: Conclusion;
  [SKILL_RUN_ENTRY]: { text: string };
}

/** A pulse a message is about. */
export type JobRef = { jobId: string; status: Job["status"] };
/** Each custom message turri sends a chat, by its `customType`: its `details` - undefined for one that carries none. */
export interface ChatMessageMap {
  [COMMAND_OUTCOME]: undefined;
  [JOB_ENTRY]: JobRef;
  [CONCLUDED_ENTRY]: { jobId?: string; checkId?: string; verdict: Conclusion["verdict"] };
  [SKILL_RUN_ENTRY]: { skills: string[]; runs: { skill: string; kind?: ScriptKind; plainFile?: string }[] };
  [SKILL_REPORT_ENTRY]: { skills: string[] };
  [SPEC_CONFLICT_MESSAGE]: { jobId: string };
  [SENTINEL_PULSE_MESSAGE]: JobRef;
  [SENTINEL_CHECK_MESSAGE]: { checkId: string; module: string; funcIds: string[] };
  [SENTINEL_RESUME_MESSAGE]: undefined;
  [JOB_LANDED_MESSAGE]: JobRef;
  [NOTICE_ANSWER_MESSAGE]: undefined;
  [LAUNCH_MESSAGE]: { launch: string; status: LaunchStatus; replacedBy?: string };
}

/** A custom entry turri appended, by its type. */
export type ChatEntryOf<K extends keyof ChatEntryMap> = { type: "custom"; customType: K; data: ChatEntryMap[K] };
/** A custom message turri sent, by its type. */
export type ChatMessageOf<K extends keyof ChatMessageMap> = Pick<CustomMessageEntry, "type" | "content" | "display"> & { customType: K } & (ChatMessageMap[K] extends undefined ? { details?: undefined } : { details: ChatMessageMap[K] });
/** A turri entry or message from pi's live transcript or a saved branch. Narrow by `type`, then `customType`. */
export type ChatEntry = { [K in keyof ChatEntryMap]: ChatEntryOf<K> }[keyof ChatEntryMap] | { [K in keyof ChatMessageMap]: ChatMessageOf<K> }[keyof ChatMessageMap];
/** Every customType turri uses, entries and messages. */
export type ChatEntryType = ChatEntry["customType"];

// What each entry's data and each message's details must be, checked as a record is read: one saved by another
// extension, or written wrong, is not turri's. Each schema is its type's, exactly (`Same` below): changing one alone
// does not compile.
const Str = Type.String();
const Opt = <T extends TSchema>(schema: T) => Type.Optional(schema);
const Text = Type.Object({ text: Str });
const ModuleText = Type.Object({ module: Str, text: Str });
const NoticeStates = Type.Enum(["open", "accepted", "steered", "dismissed", "ignored", "superseded"]);
const Verdict = Type.Enum(["holds", "wrong", "unchecked"]);
const JobRefSchema = Type.Object({ jobId: Str, status: Type.Enum(["queued", "running", "succeeded", "failed", "stopped"]) });

const ENTRY_SCHEMAS = {
  [BANNER_ENTRY]: Type.Object({
    name: Opt(Str),
    version: Str,
    commit: Opt(Str),
    changed: Opt(Type.Boolean()),
    pending: Type.Number(),
    sandbox: Opt(Type.Object({ level: Type.Enum(["ok", "limited"]), text: Str })),
    versions: Opt(Type.Array(Str)),
    config: Opt(Type.Array(Type.Object({ kind: Type.Enum(["broken", "renamed", "old-beside-new", "unknown"]), file: Str, text: Str }))),
  }),
  [VERSION_ENTRY]: Text,
  [COMMAND_OUTCOME]: Type.Object({ command: Str, text: Opt(Str), level: Opt(Type.Enum(["info", "warning", "error"])), echoed: Opt(Type.Boolean()) }),
  [SIDE_ENTRY]: Type.Object({ question: Str, answer: Str }),
  [SKILL_MESSAGE_ENTRY]: Type.Object({ text: Str, skill: Str }),
  [INTERVIEW_ENTRY]: Type.Object({ skill: Str, said: Opt(Str), question: Str, answer: Str }),
  [JOB_ENTRY]: Type.Object({ id: Str, summary: Str, status: Type.Enum(["succeeded", "failed", "stopped"]), incomplete: Opt(Type.Boolean()), duration: Str, spent: Opt(Str), text: Str }),
  [HISTORY_ENTRY]: ModuleText,
  [MILESTONE_ENTRY]: ModuleText,
  [JOBS_LIST_ENTRY]: Text,
  [NOTICE_ENTRY]: Type.Object({
    kind: Opt(Type.Enum(["sentinel-start", "fixed"])),
    severity: Type.Enum(["error", "warning", "info"]),
    summary: Str,
    evidence: Type.Array(Str),
    actions: Type.Array(Type.Object({ label: Str, task: Str })),
    module: Opt(Str),
    job: Opt(Str),
    pulse: Opt(Type.Number()),
    check: Opt(Str),
    ignorable: Opt(Type.Boolean()),
    id: Str,
    chat: Str,
    state: NoticeStates,
    at: Str,
  }),
  [NOTICE_OVER_ENTRY]: Type.Object({ state: NoticeStates, summary: Str }),
  [CONCLUDED_ENTRY]: Type.Object({ job: Opt(Str), check: Opt(Str), verdict: Verdict, summary: Str, module: Opt(Str), pulse: Opt(Type.Number()) }),
  [SKILL_RUN_ENTRY]: Text,
};

/** A message's details: a schema, or none for one that carries none. */
const MESSAGE_SCHEMAS = {
  [COMMAND_OUTCOME]: undefined,
  [JOB_ENTRY]: JobRefSchema,
  [CONCLUDED_ENTRY]: Type.Object({ jobId: Opt(Str), checkId: Opt(Str), verdict: Verdict }),
  [SKILL_RUN_ENTRY]: Type.Object({ skills: Type.Array(Str), runs: Type.Array(Type.Object({ skill: Str, kind: Opt(Type.Enum(["unit", "conformance"])), plainFile: Opt(Str) })) }),
  [SKILL_REPORT_ENTRY]: Type.Object({ skills: Type.Array(Str) }),
  [SPEC_CONFLICT_MESSAGE]: Type.Object({ jobId: Str }),
  [SENTINEL_PULSE_MESSAGE]: JobRefSchema,
  [SENTINEL_CHECK_MESSAGE]: Type.Object({ checkId: Str, module: Str, funcIds: Type.Array(Str) }),
  [SENTINEL_RESUME_MESSAGE]: undefined,
  [JOB_LANDED_MESSAGE]: JobRefSchema,
  [NOTICE_ANSWER_MESSAGE]: undefined,
  [LAUNCH_MESSAGE]: Type.Object({ launch: Str, status: Type.Enum(["waiting", "running", "launched", "failed", "stopped", "superseded"]), replacedBy: Opt(Str) }),
};

/**
 * Whether two types are the same: each assignable to the other, with the same keys - an optional one too - all the way
 * down, through arrays and the members of unions.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? SameKeys<A, B> : false) : false;
type SameKeys<A, B> = [A] extends [readonly (infer X)[]]
  ? [B] extends [readonly (infer Y)[]] ? Same<X, Y> : false
  : [A] extends [object]
    ? [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? (false extends { [K in keyof A & keyof B]-?: Same<NonNullable<A[K]>, NonNullable<B[K]>> }[keyof A & keyof B] ? false : true) : false) : false
    : true;
type StaticOf<T> = T extends TSchema ? Static<T> : undefined;
// Each schema is its type's: a field added, removed or retyped in one alone fails here.
const entriesMatch: { [K in keyof ChatEntryMap]: Same<StaticOf<(typeof ENTRY_SCHEMAS)[K]>, ChatEntryMap[K]> } = {
  turri_banner: true, turri_version: true, turri_command_outcome: true, turri_btw: true, turri_skill_message: true, turri_exchange: true, turri_job: true,
  turri_history: true, turri_milestone: true, turri_jobs: true, turri_notice: true, turri_notice_over: true, turri_sentinel_concluded: true, turri_skill_run: true,
};
const messagesMatch: { [K in keyof ChatMessageMap]: Same<StaticOf<(typeof MESSAGE_SCHEMAS)[K]>, ChatMessageMap[K]> } = {
  turri_command_outcome: true, turri_job: true, turri_sentinel_concluded: true, turri_skill_run: true, turri_skill_report: true, turri_spec_conflict: true,
  turri_sentinel_pulse: true, turri_sentinel_check: true, turri_sentinel_resume: true, turri_job_landed: true, turri_notice_answer: true, turri_launch: true,
};
void entriesMatch;
void messagesMatch;

/** A record of pi's transcript: an entry of its session, or a custom message as pi delivers it. */
export type TranscriptRecord = SessionEntry | Pick<CustomMessageEntry, "type" | "customType" | "content" | "details" | "display">;

/**
 * Whether a record of pi's transcript is one turri wrote: its type is turri's, and what it carries is what that type
 * carries - every field its type has, of its type. Narrows to ChatEntry; safe as an array filter. A record another
 * extension wrote under a name of turri's, or one written wrong, is not. Data saved by an earlier turri may lack a field
 * added since: the fields a later turri added are optional in their types.
 */
export function isChatEntry<T extends TranscriptRecord>(entry: T): entry is T & ChatEntry {
  if (entry.type === "custom") return Object.hasOwn(ENTRY_SCHEMAS, entry.customType) && Value.Check(ENTRY_SCHEMAS[entry.customType as keyof ChatEntryMap], entry.data);
  if (entry.type !== "custom_message" || !Object.hasOwn(MESSAGE_SCHEMAS, entry.customType)) return false;
  const schema = MESSAGE_SCHEMAS[entry.customType as keyof ChatMessageMap];
  return schema === undefined ? entry.details === undefined : Value.Check(schema, entry.details);
}

/** Whether a record of pi's transcript - or a ChatEntry already - is turri's of this `customType`. Narrows to it. */
export function isChatEntryOf<T extends TranscriptRecord | ChatEntry, K extends ChatEntryType>(entry: T, customType: K): entry is T & Extract<ChatEntry, { customType: K }> {
  return (entry as { customType?: string }).customType === customType && isChatEntry(entry as TranscriptRecord);
}

// Both writers check the same discriminated payloads that readers narrow above.
export function appendChatEntry<K extends keyof ChatEntryMap>(pi: ExtensionAPI, kind: K, data: ChatEntryMap[NoInfer<K>]): void {
  pi.appendEntry(kind, data);
}

type WithoutType<T> = T extends unknown ? Omit<T, "type"> : never;
type Outgoing = WithoutType<{ [K in keyof ChatMessageMap]: ChatMessageOf<K> }[keyof ChatMessageMap]>;
export function sendChatMessage(pi: ExtensionAPI, message: Outgoing, options?: Parameters<ExtensionAPI["sendMessage"]>[1]): void {
  pi.sendMessage<unknown>(message, options);
}

/**
 * What the model reads of a chat: each message of turri's own inside a `<turri-note>`. pi hands a custom message to the
 * model as one of the person's, and one sent with no turn of its own goes with the person's next message, in the same
 * turn - framed, the model tells turri's note from what the person said. The transcript keeps each as it was sent, and
 * a session saved before is framed the same. Another extension's messages, and everything else, are left as they are.
 */
export function framedForModel<M>(messages: readonly M[]): M[] {
  return messages.map((message) => {
    const sent = message as { role?: unknown; customType?: unknown; content?: unknown };
    if (sent.role !== "custom" || typeof sent.customType !== "string" || !Object.hasOwn(MESSAGE_SCHEMAS, sent.customType)) return message;
    const content =
      typeof sent.content === "string"
        ? `<turri-note>\n${sent.content}\n</turri-note>`
        : Array.isArray(sent.content)
          ? [{ type: "text", text: "<turri-note>" }, ...(sent.content as unknown[]), { type: "text", text: "</turri-note>" }]
          : sent.content;
    return { ...message, content };
  });
}

import type { ConfigLine } from "./config.ts";
import type { sandboxSummary } from "./regenerate/os-sandbox.ts";
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
/** A newer turri out, found once turri had started (turri-versions.ts). */
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
  version: string;
  /** The commit, when turri runs from a clone - and whether the clone has changes on it. */
  commit?: string;
  changed?: boolean;
  /** How many skills failed to load. */
  pending: number;
  sandbox?: ReturnType<typeof sandboxSummary>;
  /** A newer turri out, or installed and hidden behind this one on the PATH: a line each (turri-versions.ts). */
  versions?: string[];
  /** What turri says of the config files: a key it renamed in one, an old name left, keys it does not read. */
  config?: ConfigLine[];
}

export const NOTICE_ENTRY = "turri_notice";
export const NOTICE_OVER_ENTRY = "turri_notice_over";
export const CONCLUDED_ENTRY = "turri_sentinel_concluded";
export const SKILL_RUN_ENTRY = "turri_skill_run";
export const SKILL_REPORT_ENTRY = "turri_skill_report";

interface Entries {
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

type JobDetails = { jobId: string; status: Job["status"] };
interface Messages {
  [COMMAND_OUTCOME]: undefined;
  [JOB_ENTRY]: JobDetails;
  [CONCLUDED_ENTRY]: { jobId?: string; checkId?: string; verdict: Conclusion["verdict"] };
  [SKILL_RUN_ENTRY]: { skills: string[]; runs: { skill: string; kind?: ScriptKind; plainFile?: string }[] };
  [SKILL_REPORT_ENTRY]: { skills: string[] };
  turri_spec_conflict: { jobId: string };
  turri_sentinel_pulse: JobDetails;
  turri_sentinel_check: { checkId: string; module: string; funcIds: string[] };
  turri_sentinel_resume: undefined;
  turri_job_landed: JobDetails;
  turri_notice_answer: undefined;
  turri_launch: { launch: string; status: LaunchStatus; replacedBy?: string };
}

type Entry = { [K in keyof Entries]: { type: "custom"; customType: K; data: Entries[K] } }[keyof Entries];
type Message = { [K in keyof Messages]: Pick<CustomMessageEntry, "type" | "content" | "display"> & { customType: K } & (Messages[K] extends undefined ? { details?: undefined } : { details: Messages[K] }) }[keyof Messages];
/** A turri entry from pi's live transcript or saved branch. Narrow by type, then customType. */
export type ChatEntry = Entry | Message;

const entries = { turri_banner: 1, turri_version: 1, turri_command_outcome: 1, turri_btw: 1, turri_skill_message: 1, turri_exchange: 1, turri_job: 1, turri_history: 1, turri_milestone: 1, turri_jobs: 1, turri_notice: 1, turri_notice_over: 1, turri_sentinel_concluded: 1, turri_skill_run: 1 } satisfies Record<keyof Entries, 1>;
const needsDetails = {
  turri_command_outcome: false, turri_job: true, turri_sentinel_concluded: true,
  turri_skill_run: true, turri_skill_report: true, turri_spec_conflict: true,
  turri_sentinel_pulse: true, turri_sentinel_check: true, turri_sentinel_resume: false,
  turri_job_landed: true, turri_notice_answer: false, turri_launch: true,
} satisfies { [K in keyof Messages]: Messages[K] extends undefined ? false : true };

type PiRecord = SessionEntry | Pick<CustomMessageEntry, "type" | "customType" | "content" | "details" | "display">;

/** Recognise records written by turri in pi's transcript, by their reserved tags and payload envelopes. */
export function isChatEntry<T extends PiRecord>(entry: T): entry is T & ChatEntry {
  if (entry.type === "custom") return Object.hasOwn(entries, entry.customType) && typeof entry.data === "object" && entry.data !== null;
  if (entry.type !== "custom_message" || !Object.hasOwn(needsDetails, entry.customType)) return false;
  return needsDetails[entry.customType as keyof Messages] ? typeof entry.details === "object" && entry.details !== null : entry.details === undefined;
}

// Both writers check the same discriminated payloads that readers narrow above.
export function appendChatEntry<K extends keyof Entries>(pi: ExtensionAPI, kind: K, data: Entries[NoInfer<K>]): void {
  pi.appendEntry(kind, data);
}

type WithoutType<T> = T extends unknown ? Omit<T, "type"> : never;
type Outgoing = WithoutType<Message>;
export function sendChatMessage(pi: ExtensionAPI, message: Outgoing, options?: Parameters<ExtensionAPI["sendMessage"]>[1]): void {
  pi.sendMessage<unknown>(message, options);
}

import type { ConfigLine } from "./config.ts";
import type { sandboxSummary } from "./regenerate/os-sandbox.ts";

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

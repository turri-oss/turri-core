import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskUserIO } from "./ask.ts";
import type { CaptureStatus } from "./capture/progress.ts";
import type { ChatLink, TurriCore } from "./chats.ts";
import type { Job } from "./regenerate/jobs.ts";
import type { SkillProgress } from "./session-events.ts";

/**
 * What a front-end draws of a turri session that the core does not: the terminal's (turri's CLI) - its entry renderers,
 * banner, side panel, question dialog and keys. The core decides and does everything; a view only shows it. A host
 * (turri-app) and a headless run pass none, and the core behaves for them as it always has.
 *
 * Given to `createTurriCore(host, { view })` - never as a TurriHost field: a host with any key is a host to the ledger.
 */
export interface TurriView {
  /**
   * Built into every chat - the sentinel's too - inside the chat's scope, where turri's extension registers its own
   * terminal parts: after its handlers that remember the chat's context, before its capture and skill commands, so
   * a banner drawn on session_start comes before a capture's report. Registers what only a screen needs: entry and
   * message renderers, the banner's painting, the side panel's key.
   */
  chat?(pi: ExtensionAPI, chat: ViewChat): void;
  /**
   * Built into every chat of a terminal session (`TurriCore.terminal`), inside the chat's scope, where turri's extension
   * registers the terminal's chat commands: after its conversation's commands (`/btw` the last of them), before its
   * capture and skill commands - so pi's command list keeps turri's order. Registers `/chat` and its keys.
   */
  chatCommands?(pi: ExtensionAPI, chat: ViewChat): void;
  /** How a question is put to the person in a chat that has a screen and no host dialogs. */
  questions?: QuestionView;
  /** The session's side panel - one for every chat. `/pulses`, `/notifications` and the chat header's toggle open it. */
  panel?(session: TurriCore): SidePanelView;
  /** A pulse ended and was not replaced by another: just before the session tells its chats (`TurriCore.jobFinished`). */
  pulseFinished?(job: Job): void;
  /** A `/capture` running in a chat with a screen: its status, drawn above the input until it ends. */
  captureProgress?(ctx: ExtensionContext): CaptureProgressView;
  /** A foreground skill starts or changes step/attempt; null clears the chat's widget on every exit. */
  skillProgress?(ctx: ExtensionContext, progress: SkillProgress | null): void;
  /** pi's own settings menu, where the screen has one: true once opened. */
  openPiSettings?(): boolean;
}

/** A chat, as its view sees it. */
export interface ViewChat {
  readonly session: TurriCore;
  readonly link: ChatLink;
  /** The context the chat's tools and handlers were last given - undefined until its session starts. */
  context(): ExtensionContext | undefined;
}

/** A question open in a dialog: whether the person declined it, and how to close the dialog from outside. */
export interface Declining {
  declined: boolean;
  /** Set by the dialog shown, so a stopped turn closes it. */
  close: (() => void) | undefined;
}

/** The terminal's way of asking: dialogs over the chat, and keys they let through. */
export interface QuestionView {
  /**
   * The dialogs one question is put in, in ctx's chat. `decline` is the person declining at a dialog - turri's answer
   * says so - and the dialog shown sets `declining.close`. Once the question is declined (`declining.declined`), turri
   * opens none of them again: a dialog asked for then never reaches the view, and comes back with no answer.
   */
  dialogs(ctx: ExtensionContext, declining: Declining, decline: () => void): AskUserIO;
  /** While a question waits in ctx's chat: the keys its dialog lets through (the side panel's peek). Returns its undo. */
  whileAsking?(ctx: ExtensionContext): () => void;
}

/** What the side panel shows: the regeneration (regen), the pulses, or finished pulses and sentinel notices. */
export type PanelPage = "map" | "pulses" | "notifications";

export interface SidePanelView {
  /** Opened on a page - the one it was on when none is named - over the screen, or beside the chat. */
  open(ctx: ExtensionContext, page?: PanelPage, placement?: "beside"): void;
  /** On the screen, beside the chat or over it. */
  visible(): boolean;
  close(): void;
}

/** A capture's status above the input. `close` may be called more than once. */
export interface CaptureProgressView {
  update(status: CaptureStatus): void;
  close(): void;
}

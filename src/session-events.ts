import type { ModelEvent } from "./regenerate/activity.ts";
import type { ChatEntry } from "./chat-entries.ts";
import type { CaptureResult } from "./capture/capture.ts";
import type { CaptureStatus } from "./capture/progress.ts";

/** A foreground skill's position. A view chooses its own width, colours and animation. */
export interface SkillProgress {
  skill: string;
  phases: readonly string[];
  /** Zero based; -1 until the first step starts. */
  current: number;
  attempt: number;
  about?: string;
}

export type SessionEvent =
  | { type: "orphansStopped"; count: number }
  | { type: "incident"; event: ModelEvent; text: string }
  | { type: "agentCost"; role?: string; cost: number; total: number }
  | { type: "skillProgress"; chat: string; progress: SkillProgress | null }
  | { type: "captureProgress"; chat: string; status: CaptureStatus }
  | ({ type: "captureEnded"; chat: string; root: string } & (
      | { state: "completed"; result: CaptureResult }
      | { state: "failed"; error: string }
      | { state: "stopped" }
    ))
  | { type: "entry"; chat: string; entry: ChatEntry }
  /** What turri says to the person, outside any chat's transcript: in the chat shown, as pi says what an extension says. */
  | { type: "notification"; chat?: string; text: string; level: "info" | "warning" | "error" };

/** An observer that has lost its window must not interrupt a skill or prevent a chat from opening. */
export function emitSessionEvent(host: { onEvent?(event: SessionEvent): void }, event: SessionEvent): void {
  try { host.onEvent?.(event); } catch { /* observation only */ }
}

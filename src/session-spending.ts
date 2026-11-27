import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ChatRole } from "./notice.ts";
import type { Job } from "./regenerate/jobs.ts";

/** Dollars spent in this run. Costs already in a reopened conversation belong to its earlier run. */
export interface SessionSpending {
  chat: number;
  sentinel: number;
  regeneration: number;
  /** Calls outside a pulse, by agent role; null when the agent has no role. */
  other: Array<{ role: string | null; cost: number }>;
}

/** Keep totals, not old conversations. pi counts all billed entries, including compacted messages. */
export function createSessionSpending() {
  const closed = { chat: 0, sentinel: 0 };
  const live = new Map<AgentSession, { who: keyof typeof closed; opening: number }>();
  const other = new Map<string | null, number>();
  return {
    opened(session: AgentSession, role?: ChatRole) {
      if (!live.has(session)) live.set(session, { who: role ?? "chat", opening: session.getSessionStats().cost });
    },
    closed(session: AgentSession) {
      const row = live.get(session);
      if (!row) return;
      closed[row.who] += session.getSessionStats().cost - row.opening;
      live.delete(session);
    },
    agent(role: string | undefined, cost: number) {
      const key = role ?? null;
      const total = (other.get(key) ?? 0) + cost;
      other.set(key, total);
      return total;
    },
    snapshot(jobs: Job[]): SessionSpending {
      const sum = { ...closed };
      for (const [session, row] of live) sum[row.who] += session.getSessionStats().cost - row.opening;
      return {
        ...sum,
        regeneration: jobs.reduce((cost, job) => cost + job.usage.cost, 0),
        other: Array.from(other, ([role, cost]) => ({ role, cost })),
      };
    },
  };
}

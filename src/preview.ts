import type { ModuleStatus, PlannedPulse, WorkLoop } from "./regenerate/loop.ts";
import { whenBuildable } from "./loop-tools.ts";
import { refuseTestPlainFile } from "./test-plain-files.ts";

/** The same preview from a host, the chat or the CLI, including what cannot be planned. */
export function lookAhead(loop: WorkLoop, plainFile: string): Promise<ModuleStatus[]> {
  refuseTestPlainFile(plainFile);
  return whenBuildable(plainFile, () => loop.lookAhead(plainFile));
}

/** The next available prompt in each codebase, read from the plan the loop already holds. */
export async function* nextPulses(loop: WorkLoop, statuses: ModuleStatus[]): AsyncGenerator<PlannedPulse> {
  for (const status of statuses) {
    const first = status.planned[0];
    if (!first || first.afterCode || first.planning) continue;
    const next = await loop.plannedPulse(`planned-${status.module}-1`);
    if (next) yield next;
  }
}

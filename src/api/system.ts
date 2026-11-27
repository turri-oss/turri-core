/**
 * `@turri-dev/core/system`: the machine turri runs on - whether it is ready (`doctor`, each check with a stable name),
 * the Node it needs, what an agent's command would change on it, and the core's own version.
 */
import { coreIdentity, piVersion } from "../environment.ts";
import type { DoctorOptions } from "../doctor-checks.ts";
import type { Check } from "../node-check.ts";

/** The core's own version - and its commit, when it runs from a clone - with the pi it runs on. */
export function coreVersion(): { version: string | null; commit: string | null; changed: boolean | null; pi: string | null } {
  const identity = coreIdentity();
  return { version: identity.version, commit: identity.git_commit, changed: identity.git_dirty, pi: piVersion() ?? null };
}

/**
 * Whether this machine - and, with `dir`, that project - is ready for turri, as checks: each named, with what to do when
 * it is not. It prints nothing and asks nothing; with `models`, each model is asked for a word, which costs money.
 */
export async function doctor(options: DoctorOptions = {}): Promise<Check[]> {
  // The checks of providers and models load pi: only once doctor runs, so the rest of this entry loads none.
  const { doctor: check } = await import("../setup.ts");
  return check(options);
}

export { asksModels, verdictOf, describeChecks, type DoctorModels, type DoctorOptions } from "../doctor-checks.ts";
export { checkNode, type Check, type Level } from "../node-check.ts";
export { MIN_NODE, nodeVersionOk } from "../environment.ts";
export { machineChange, machineChangeReason } from "../regenerate/command-check.ts";

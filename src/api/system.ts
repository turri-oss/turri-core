/**
 * `@turri-dev/core/system`: the machine turri runs on - whether it is ready (`doctor`, each check with a stable name),
 * the Node it needs, what an agent's command would change on it, and the core's own version.
 */
import { coreIdentity, piVersion } from "../environment.ts";

/** The core's own version - and its commit, when it runs from a clone - with the pi it runs on. */
export function coreVersion(): { version: string | null; commit: string | null; changed: boolean | null; pi: string | null } {
  const identity = coreIdentity();
  return { version: identity.version, commit: identity.git_commit, changed: identity.git_dirty, pi: piVersion() ?? null };
}

export { asksModels, doctor, verdictOf, describeChecks, type DoctorOptions } from "../setup.ts";
export { checkNode, type Check, type Level } from "../node-check.ts";
export { MIN_NODE, nodeVersionOk } from "../environment.ts";
export { machineChange, machineChangeReason } from "../regenerate/command-check.ts";

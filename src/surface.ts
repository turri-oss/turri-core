import type { JobRegistry } from "./regenerate/jobs.ts";

/**
 * Where the person sees turri's work, in the front end's own words (TurriHost.surface) - none said, no view is named.
 * Kept with the conversation's job registry, so what is told the model deep in a tool says the front end's words.
 */
const surfaces = new WeakMap<JobRegistry, string>();

/** The front end's surface for the conversation these jobs are: blank or undefined, none. */
export function setSurface(jobs: JobRegistry, surface: string | undefined): void {
  const text = surface?.trim() ?? "";
  if (text !== "") surfaces.set(jobs, text);
  else surfaces.delete(jobs);
}

/** The front end's surface, in its own words - undefined when it gave none. */
export function surfaceOf(jobs: JobRegistry | undefined): string | undefined {
  return jobs !== undefined ? surfaces.get(jobs) : undefined;
}

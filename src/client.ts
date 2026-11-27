import { coreIdentity } from "./environment.ts";

/**
 * Who runs turri: the front end's own name and version - turri's CLI, a desktop app, an editor's extension - as it says
 * it when it opens a session. The banner shows it, and the ledger and a run's report record it. Without one, it is the
 * core itself.
 */
export interface ClientInfo {
  /** The front end's name: `turri`, `turri desktop`. */
  name: string;
  version: string;
  /** The commit it runs from, when it runs from a clone - and whether the clone has changes on it. */
  commit?: string;
  changed?: boolean;
}

/** What is recorded of who ran turri. */
export interface Identity {
  name: string;
  version: string | null;
  git_commit: string | null;
  git_dirty: boolean | null;
}

let client: ClientInfo | undefined;

/** The session's front end, said as it opens - undefined as it closes. */
export function setClient(info: ClientInfo | undefined): void {
  client = info;
}

/** Who runs turri now: the session's front end, else the core. */
export function clientIdentity(): Identity {
  if (client !== undefined) return { name: client.name, version: client.version, git_commit: client.commit ?? null, git_dirty: client.changed ?? null };
  return { name: "@turri-dev/core", ...coreIdentity() };
}

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What turri needs from the machine it runs on, found out without changing anything.
 *
 * Kept free of heavy imports so the CLI can ask these questions before it has loaded pi - and so `turri doctor` can report a missing piece instead of crashing on it.
 */

/** The core's own package: its genome, stdlib, docs and grammar are read from here. */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const AGENT_DIR = join(homedir(), ".pi", "agent");

/** The oldest Node that runs .ts files by itself, which is how turri runs. */
export const MIN_NODE = [22, 19] as const;

export function nodeVersionOk(version: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Whether a command runs at all. */
export function runs(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 15_000 });
  return result.status === 0;
}

/** The version of the pi turri runs on, as Node finds it - undefined when it is not installed. */
export function piVersion(): string | undefined {
  try {
    // Its entry point, then up to the package.json that names it.
    for (let dir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))); dirname(dir) !== dir; dir = dirname(dir)) {
      const file = join(dir, "package.json");
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@earendil-works/pi-coding-agent") return pkg.version;
    }
  } catch {
    /* not installed: left out */
  }
  return undefined;
}

/** The core's own version, and the commit when it runs from a clone. */
export function coreIdentity(): { version: string | null; git_commit: string | null; git_dirty: boolean | null } {
  const root = PACKAGE_ROOT;
  let version: string | null = null;
  try {
    version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    /* no package.json: left out */
  }
  if (!existsSync(join(root, ".git"))) return { version, git_commit: null, git_dirty: null };
  const commit = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  return {
    version,
    git_commit: commit.status === 0 ? commit.stdout.trim() : null,
    git_dirty: status.status === 0 ? status.stdout.trim() !== "" : null,
  };
}

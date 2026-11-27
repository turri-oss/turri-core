import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nodeVersionOk, piVersion, versionLine } from "../src/environment.ts";
import { defaultParallelJobs } from "../src/regenerate/jobs.ts";
import { sandboxSummary } from "../src/regenerate/os-sandbox.ts";
import { describeVersion, PACKAGE_NAME } from "../src/turri-versions.ts";

describe("the Node turri runs on", () => {
  it("is 22.19 or newer - it runs .ts files itself, and pi needs 22.19", () => {
    expect(nodeVersionOk("22.19.0")).toBe(true);
    expect(nodeVersionOk("22.18.0")).toBe(false);
    expect(nodeVersionOk("23.1.0")).toBe(true);
    expect(nodeVersionOk("26.8.2")).toBe(true);
    expect(nodeVersionOk("22.17.1")).toBe(false);
    expect(nodeVersionOk("20.19.0")).toBe(false);
  });
});

describe("where the agents' commands run, as the banner says it", () => {
  it("names the walls that are up, and where no OS sandbox starts, why - and turri doctor", () => {
    expect(sandboxSummary({ kind: "seatbelt" })).toEqual({ level: "ok", text: "agents' commands run on this machine behind the command check, Seatbelt and the audit" });
    expect(sandboxSummary({ kind: "none", why: "bubblewrap is not installed" })).toEqual({
      level: "limited",
      text: "agents' commands run on this machine behind the command check and the audit - no OS sandbox: bubblewrap is not installed (turri doctor)",
    });
  });
});

describe("how many pulses run at once when nothing says", () => {
  it("is half this machine's cores, at least one and at most four", () => {
    expect(defaultParallelJobs(1)).toBe(1);
    expect(defaultParallelJobs(2)).toBe(1);
    expect(defaultParallelJobs(6)).toBe(3);
    expect(defaultParallelJobs(16)).toBe(4);
  });
});

describe("turri --version", () => {
  it("says turri's version with pi's beside it - from a clone, its commit too, as the banner does", () => {
    expect(versionLine({ version: "0.1.6", git_commit: null, git_dirty: null }, "1.3.0")).toBe("turri 0.1.6 (pi 1.3.0)");
    expect(versionLine({ version: "0.1.1", git_commit: "336dd6e0f1a2b3c4", git_dirty: true }, "1.3.0")).toBe("turri 0.1.1, from a clone, 336dd6e with changes (pi 1.3.0)");
    expect(versionLine({ version: "0.1.1", git_commit: "336dd6e0f1a2b3c4", git_dirty: false }, null)).toBe("turri 0.1.1, from a clone, 336dd6e");
  });

  it("says its version line first, then where this turri is and every turri on the PATH", async () => {
    expect(piVersion()).toMatch(/^\d+\.\d+\.\d+/);
    // npm never answers, and a turri is installed on the PATH as npm installs one - an npm prefix, as tests/turri-versions.test.ts has them.
    const prefix = mkdtempSync(join(tmpdir(), "turri-version-"));
    const root = join(prefix, "lib", "node_modules", "@turri-dev", "cli");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: "0.1.24" }));
    mkdirSync(join(prefix, "bin"));
    writeFileSync(join(prefix, "bin", "turri"), "#!/bin/sh\n");
    chmodSync(join(prefix, "bin", "turri"), 0o755);
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in a test");
    });
    vi.stubEnv("PATH", [join(prefix, "bin"), process.env.PATH ?? ""].join(delimiter));
    try {
      const lines = (await describeVersion(versionLine())).trim().split("\n");
      expect(lines[0]).toMatch(new RegExp(`^turri \\S+.*\\(pi ${piVersion()!.replace(/\./g, "\\.")}\\)$`));
      expect(lines[1]).toMatch(/^ {2}this turri: +\//);
      expect(lines.some((line) => line.startsWith("  turri on PATH"))).toBe(true);
      // The turri installed on the PATH is listed by its path and its version - the one a bare `turri` runs, first on it.
      expect(lines).toContain(`    ${join(prefix, "bin", "turri")}  turri 0.1.24  (runs)`);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      rmSync(prefix, { recursive: true, force: true });
    }
  });
});

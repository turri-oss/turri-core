import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { followLaunchedLogs, runningLaunched, startLaunched, stopLaunched } from "../../src/regenerate/launch.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turri-follow-"));
  mkdirSync(join(dir, "site"));
});
afterEach(async () => {
  await stopLaunched();
  rmSync(dir, { recursive: true, force: true });
});

describe("following what a launch started", () => {
  it("gives each line each launched process writes, with its name, until nothing it started runs", async () => {
    const start = (name: string, command: string) => startLaunched({ name, command, dir: join(dir, "site"), moduleName: "app", logDir: join(dir, "logs") });
    // One that serves on past its start, and one that ended before it was ready: its output is followed all the same.
    const [web, job] = await Promise.all([start("web", "echo one; echo; echo two; sleep 5; echo three"), start("job", "echo done; exit 0")]);
    expect(web.ok).toBe(true);
    expect(job.ok).toBe(false);
    const lines: Array<[string, string]> = [];
    await followLaunchedLogs((name, line) => lines.push([name, line]), { pollMs: 50 });
    // Each process's lines in the order it wrote them - an empty one left out - the last written as it ended.
    expect(lines.filter(([name]) => name === "web").map(([, line]) => line)).toEqual(["one", "two", "three"]);
    expect(lines.filter(([name]) => name === "job").map(([, line]) => line)).toEqual(["done"]);
    expect(lines).toHaveLength(4);
    expect(runningLaunched()).toEqual([]);
  });

  it("ends at once when nothing a launch started runs, having given what their logs hold", async () => {
    const ended = await startLaunched({ name: "job", command: "echo done; exit 0", dir: join(dir, "site"), moduleName: "app", logDir: join(dir, "logs") });
    expect(ended.ok).toBe(false);
    const lines: Array<[string, string]> = [];
    await followLaunchedLogs((name, line) => lines.push([name, line]), { pollMs: 50 });
    expect(lines).toEqual([["job", "done"]]);
  });
});

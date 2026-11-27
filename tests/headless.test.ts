import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadlessEnd, HeadlessView } from "../src/headless.ts";
import type { Job } from "../src/regenerate/jobs.ts";
import type { ModuleStatus } from "../src/regenerate/loop.ts";

/** The core's sources, for a run in a process of its own - found before a test moves into its project. */
const SRC = resolve("src");

/** How many process groups a killed turri left running the sweep says it stopped - none, unless a test says. */
const sweep = { stopped: 0 };

/** The spec gap the stubbed coding agent reports, and the provider failure its turn waits out. */
const GAP = { question: "What does the app print when it is given no argument?", assumption: "It prints one - asserted in test_app.py." };
const RETRY = { kind: "provider_retry", role: "coding agent", model: "nowhere/small", error: "overloaded", attempt: 1, of: 3, waitMs: 2000 } as const;

type StubSession = { tools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> };
/**
 * The agents, scripted by the tools they are given. The coding agent, in its one turn, builds the app and its unit test,
 * reports a spec gap, meets a provider failure and runs its unit tests, as a real one would. Every other agent - the
 * planner's - answers nothing, and the planning falls back to a functional spec a pulse.
 */
async function scriptedAgent(session: StubSession, prompt: string): Promise<string> {
  const tool = (name: string) => session.tools.find((candidate) => candidate.name === name);
  // Asked to leave notes, it does.
  if (prompt.includes("Before you finish: call update_notes")) {
    await tool("update_notes")?.execute("id", { changes: [{ section: "where", action: "add", text: "stub agent was here" }] });
    return "Done.";
  }
  if (tool("write") === undefined || tool("run_unit_tests") === undefined) return "";
  await tool("write")!.execute("id", { path: "app.py", content: "print('one')\n" });
  await tool("write")!.execute("id", {
    path: "test_app.py",
    content: "import unittest\n\nclass AppTest(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
  });
  await tool("report_spec_gap")!.execute("id", GAP);
  const { reportModelEvent } = await import("../src/regenerate/activity.ts");
  reportModelEvent(RETRY);
  await tool("run_unit_tests")!.execute("id", {});
  return "Done.";
}
// No test calls a model: every agent is scriptedAgent.
vi.mock("../src/pi.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/pi.ts")>()),
  createExecutor: vi.fn(async (opts: { customTools?: StubSession["tools"] }) => ({ tools: opts.customTools ?? [], dispose: () => {}, abort: async () => {}, turns: 0 })),
  ask: vi.fn(scriptedAgent),
}));
// Nor stops what another turri on this machine left running: the sweep is the test's.
vi.mock("../src/regenerate/shell.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/regenerate/shell.ts")>()),
  sweepOrphanedGroups: vi.fn(() => sweep.stopped),
}));
/** Every change the job registry told the run of, the job as it then stood - what a pulse's running line is made from. */
const changes: Array<{ id: string; status: string; stage: string | undefined }> = [];
vi.mock("../src/regenerate/jobs.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/regenerate/jobs.ts")>();
  return {
    ...actual,
    createJobRegistry: (options: Parameters<typeof actual.createJobRegistry>[0]) =>
      actual.createJobRegistry({
        ...options,
        onChange: (job) => {
          changes.push({ id: job.id, status: job.status, stage: job.stage });
          options?.onChange?.(job);
        },
      }),
  };
});
// A report the test process leaves alone as it exits: the run's own writes are what is tested here.
vi.mock("../src/run-report.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/run-report.ts")>();
  return { ...actual, startRunReport: (options: Parameters<typeof actual.startRunReport>[0]) => actual.startRunReport({ ...options, onExit: false }) };
});

const { buildDirProblem, moduleStates, runHeadless } = await import("../src/headless.ts");
const { pulseName } = await import("../src/regenerate/jobs.ts");
const { recordHistory } = await import("../src/regenerate/lineage.ts");
const { chainSpec } = await import("../src/regenerate/loop.ts");
const { writeCodeRecord } = await import("../src/regenerate/records.ts");
const { resolveRequiresChain } = await import("../src/regenerate/requires.ts");
const { writeTestScripts } = await import("./test-scripts.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  // Its real path: the run resolves the spec from the cwd, which is the real path on macOS's /var.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-headless-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "review: false\n");
  sweep.stopped = 0;
  changes.length = 0;
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

/** A functional spec's func-id: its first two words - "App one, changed." is still `app-one`. */
const idOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 2).join("-");

/** A spec of its own functional specs, requiring another or not. */
function spec(name: string, specs: string[], requires?: string): string {
  const file = join(dir, `${name}.plain`);
  writeFileSync(
    file,
    `${requires !== undefined ? `---\nrequires:\n  - ${requires}\n---\n\n` : ""}***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n${specs.map((text) => `# ${idOf(text)}\n${text}`).join("\n\n")}\n`,
  );
  return file;
}

/** app, built and landed - then made to require base, which its code was not built on: it has to start over. */
function builtWithoutBase(): string {
  spec("base", ["Base one."]);
  const app = spec("app", ["App one."]);
  const code = join(dir, "plain_modules", "app", "code");
  mkdirSync(code, { recursive: true });
  writeFileSync(join(code, "main.py"), "print(1)\n");
  writeCodeRecord(code, chainSpec(resolveRequiresChain(app, [], undefined, { allowNoFunctionalities: true })).tree);
  recordHistory(code, "app pulse 1 landed");
  spec("app", ["App one."], "base");
  return app;
}

/**
 * A view that records each call, in order, its name and what it was given - a pulse as it stood when the view was told,
 * as a console line printed then shows it - with someone to ask, who answers `answer`, when `answer` is given.
 */
function recordingView(answer?: boolean): { view: HeadlessView; calls: Array<[string, ...unknown[]]>; names: () => string[] } {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  const view: HeadlessView = {
    orphansStopped: record("orphansStopped"),
    warn: record("warn"),
    exported: record("exported"),
    pulseRunning: (job) => calls.push(["pulseRunning", { ...job }]),
    pulseFinished: (job) => calls.push(["pulseFinished", { ...job }]),
    turnIncident: record("turnIncident"),
    planned: record("planned"),
    canAsk: () => {
      calls.push(["canAsk"]);
      return answer !== undefined;
    },
    ask: async (title, body) => {
      calls.push(["ask", title, body]);
      return answer;
    },
    startOverRefused: record("startOverRefused"),
    nextPulse: record("nextPulse"),
    drained: record("drained"),
    ended: record("ended"),
  };
  return { view, calls, names: () => calls.map(([name]) => name) };
}

describe("each codebase's state", () => {
  it("is complete only with nothing left to regenerate, and says why when it is not", () => {
    const base = { plainFile: "x.plain", scheduled: [] };
    expect(
      moduleStates([
        { ...base, module: "a", code: null, conformance: undefined },
        { ...base, module: "b", code: null, conformance: { fresh: false, add: [], patch: [], again: [], delete: [], mechanical: true } },
        { ...base, module: "c", code: null, conformance: null, why: "pulse 1 did not land" },
        { ...base, module: "d", code: null, conformance: null, startOver: { requires: ["base"], codebases: ["d"] } },
        { ...base, module: "e", code: null, conformance: null, running: { jobId: "j", title: "t" } },
      ]),
    ).toEqual([
      { module: "a", state: "complete" },
      { module: "b", state: "incomplete", why: "its conformance tests are not written for what is built" },
      { module: "c", state: "halted", why: "pulse 1 did not land" },
      { module: "d", state: "start_over_needed", why: "built without base, which it now requires: run with --start-over" },
      { module: "e", state: "running" },
    ]);
  });
});

describe("a --build-dir", () => {
  const project = resolve("/work/app");
  const refused = (buildDir: string, why: string) => `--build-dir ${buildDir} cannot be used: ${why}. Name a folder of its own - the code is exported there as the run ends.`;

  it("is refused when it is the project, or holds it: the export replaces what is in it", () => {
    expect(buildDirProblem(project, project)).toBe(refused(project, "it holds the project, and the export replaces what is in it"));
    expect(buildDirProblem(resolve("/work"), project)).toBe(refused(resolve("/work"), "it holds the project, and the export replaces what is in it"));
  });

  it("is refused inside plain_modules, which turri regenerates in", () => {
    const modules = join(project, "plain_modules");
    expect(buildDirProblem(modules, project)).toBe(refused(modules, "it is inside plain_modules, which turri regenerates in"));
    expect(buildDirProblem(join(modules, "app", "out"), project)).toBe(refused(join(modules, "app", "out"), "it is inside plain_modules, which turri regenerates in"));
  });

  it("is the export's own anywhere else - in the project, or beside it with a name the project's starts", () => {
    expect(buildDirProblem(join(project, "out", "build"), project)).toBeUndefined();
    expect(buildDirProblem(resolve("/work/app-build"), project)).toBeUndefined();
    expect(buildDirProblem(join(project, "plain_modules-copy"), project)).toBeUndefined();
  });
});

describe("a headless run", () => {
  it("refuses a --build-dir that holds the project before anything is shown, writing nothing", async () => {
    const app = spec("app", ["App one."]);
    const { view, calls } = recordingView();
    await expect(runHeadless({ plainFile: app, buildDir: dir, ask: (loop) => loop.bringUp(app) }, view)).rejects.toThrow(
      `--build-dir ${dir} cannot be used: it holds the project`,
    );
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, "app.plain"))).toBe(true);
    expect(existsSync(join(dir, "plain_modules"))).toBe(false);
  });

  it("refuses a config that does not parse, starting nothing", async () => {
    const app = spec("app", ["App one."]);
    writeFileSync(join(dir, "config.turri.yaml"), "review: false\nreview: true\n");
    const ask = vi.fn();
    const { view, calls } = recordingView();
    await expect(runHeadless({ plainFile: app, ask }, view)).rejects.toThrow("Nothing was started:");
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("says how many process groups a killed turri left running it stopped, before anything else", async () => {
    sweep.stopped = 2;
    const app = spec("app", ["App one."]);
    writeTestScripts(dir);
    const { view, calls, names } = recordingView();
    await runHeadless({ plainFile: app, dryRun: true, ask: (loop) => loop.lookAhead(app) }, view);
    expect(names()[0]).toBe("orphansStopped");
    expect(calls[0]).toEqual(["orphansStopped", 2]);
  });

  it("looks ahead in a dry run: what is planned, then each codebase's next pulse - nothing started, built, exported or reported", async () => {
    const app = spec("app", ["App one.", "App two."]);
    writeTestScripts(dir);
    const { view, calls, names } = recordingView();
    // A --build-dir and a --report a dry run leaves alone: the one is not even checked.
    const result = await runHeadless({ plainFile: app, dryRun: true, buildDir: dir, report: join(dir, "report.json"), ask: (loop) => loop.lookAhead(app) }, view);
    expect(result).toEqual({ status: "dry_run", exitCode: 0 });
    expect(names()).toEqual(["planned", "nextPulse"]);
    const [, statuses] = calls[0]! as [string, Array<{ module: string; planned: Array<{ title: string }> }>];
    expect(statuses.map((status) => status.module)).toEqual(["app"]);
    expect(statuses[0]!.planned.map((job) => job.title)).toEqual(["App one.", "App two."]);
    const [, next] = calls[1]! as [string, { module: string; title: string; task?: string }];
    expect(next).toMatchObject({ module: "app", title: "App one." });
    expect(next.task).toContain("App one.");
    expect(existsSync(join(dir, "plain_modules", "app"))).toBe(false);
    expect(existsSync(join(dir, "report.json"))).toBe(false);
  });

  it("stops at a codebase it would have to start over when there is no one to ask - saying why, and that --start-over does it unasked", async () => {
    const app = builtWithoutBase();
    const { view, calls, names } = recordingView(undefined);
    const result = await runHeadless({ plainFile: app, ask: (loop) => loop.bringUp(app) }, view);
    expect(result).toEqual({ status: "incomplete", exitCode: 1 });
    expect(names()).toEqual(["planned", "canAsk", "startOverRefused"]);
    expect(calls[2]![1]).toBe(
      "app was built without base, which it now requires: no change to its code can bring it in.\nThere is no terminal to ask whether to start over: run it again with --start-over to start over without asking.",
    );
  });

  it("builds nothing where the person would not start over, and ends incomplete with the codebase still to start over", async () => {
    const app = builtWithoutBase();
    const { view, calls, names } = recordingView(false);
    const result = await runHeadless({ plainFile: app, ask: (loop) => loop.bringUp(app) }, view);
    expect(result).toEqual({ status: "incomplete", exitCode: 1 });
    expect(names()).toEqual(["planned", "canAsk", "ask", "drained", "ended"]);
    const [, title, body] = calls[2]! as [string, string, string];
    expect(title).toBe("Start over?");
    expect(body).toBe(
      "app was built without base, which it now requires: no change to its code can bring it in.\nStarting over takes its code and conformance tests out - they stay in its history - and builds it again from the bottom of the chain.",
    );
    const [, end] = calls[4]! as [string, { plainFile: string; jobs: unknown[]; failed: unknown[]; unfinished: unknown[] }];
    expect(end).toEqual({
      plainFile: app,
      jobs: [],
      failed: [],
      unfinished: [{ module: "app", state: "start_over_needed", why: "built without base, which it now requires: run with --start-over" }],
    });
  });

  it("tells a pulse as it starts and at each new stage only, a provider failure in it, and its end before the report is written again - then how the codebases stand and how the run ended", async () => {
    const app = spec("app", ["App one."]);
    writeTestScripts(dir);
    const report = join(dir, "out", "report.json");
    const { view, calls, names } = recordingView();
    // What the report held of the pulses as the view was told the pulse ended, and as nothing more could start.
    const reportedPulses = () =>
      (JSON.parse(readFileSync(report, "utf8")) as { pulses: { list: Array<{ id: string; status: string; landed: boolean }> } }).pulses.list.map(({ id, status, landed }) => ({ id, status, landed }));
    const reported: Record<string, unknown> = {};
    const { pulseFinished, drained } = view;
    view.pulseFinished = (job) => {
      reported.pulseFinished = reportedPulses();
      pulseFinished(job);
    };
    view.drained = (statuses) => {
      reported.drained = reportedPulses();
      drained(statuses);
    };

    const result = await runHeadless({ plainFile: app, report, command: ["regenerate", "app.plain"], ask: (loop) => loop.bringUp(app) }, view);

    expect(result).toEqual({ status: "completed", exitCode: 0 });
    // The pulse's lines come as it runs - a first may come before the plan is told - and its end, the codebases and the verdict last.
    expect(names().filter((name) => name === "planned")).toHaveLength(1);
    expect(names().filter((name) => name !== "pulseRunning" && name !== "planned")).toEqual(["turnIncident", "pulseFinished", "drained", "ended"]);
    expect(names().lastIndexOf("pulseRunning")).toBeLessThan(names().indexOf("pulseFinished"));
    const [, finished] = calls.find(([name]) => name === "pulseFinished")! as [string, Job];

    // Running (loop-cli's `▶ <id> <pulse> - <stage>`): as the pulse starts, with no stage yet, then once at each new
    // stage - a change the registry tells of in the same stage again shows nothing.
    const running = calls.filter(([name]) => name === "pulseRunning").map(([, job]) => job as Job);
    const lines = changes.map((change) => (change.status === "running" ? (change.stage ?? "started") : change.status));
    const newStages = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
    expect(changes.length).toBeGreaterThan(newStages.length);
    expect(running.map((job) => job.stage ?? "started")).toEqual(newStages);
    expect(running[0]!.stage).toBeUndefined();
    expect(running.map((job) => [job.id, job.status, pulseName(job)])).toEqual(running.map(() => [finished.id, "running", "app · regenerate pulse 1"]));

    // A provider failure (loop-cli's `  <pulse id>: <line>`): the event, with the pulse it was in, and its line.
    expect(calls.find(([name]) => name === "turnIncident")).toEqual([
      "turnIncident",
      { ...RETRY, job: finished.id },
      "The model provider failed (nowhere/small): overloaded - trying coding agent's request again in 2s (1 of 3).",
    ]);

    // Its end (loop-cli's `✓ <id> <pulse> - succeeded`, then each spec gap its agents met), told before the report is
    // written again: the report the view could read then is the one written as the run started.
    expect([finished.status, pulseName(finished)]).toEqual(["succeeded", "app · regenerate pulse 1"]);
    expect(finished.details).toMatchObject({ landed: true, specGaps: [GAP] });
    expect(reported).toEqual({ pulseFinished: [], drained: [{ id: finished.id, status: "succeeded", landed: true }] });

    // Nothing more can start (loop-cli's describeModules of the loop's status), then the verdict, each job's line and how to try it.
    const [, statuses] = calls.find(([name]) => name === "drained")! as [string, ModuleStatus[]];
    expect(statuses).toMatchObject([{ module: "app", planned: [], why: "built from the ***plain as it is" }]);
    const [, end] = calls.find(([name]) => name === "ended")! as [string, HeadlessEnd];
    expect(end).toEqual({ plainFile: app, jobs: [expect.objectContaining({ id: finished.id, status: "succeeded" })], failed: [], unfinished: [] });
  });
});

// The core of turri's own `turri regenerate, unattended` test, which runs the CLI: the run in a process of its own, as
// `turri regenerate` makes it - the options read as the config's keys, then runHeadless, then exit with its code - so
// the --build-dir export and the report's last write happen as the process exits.
describe("a headless run, in a process of its own", () => {
  it("stops, with no terminal to ask, at a codebase it would have to start over - and reports why", () => {
    builtWithoutBase();
    // The whole command a benchmark runs, as turri's CLI gives it the run: every model and review given on the command line.
    const command = [
      "regenerate", "app.plain", "--harness-model", "nowhere/big", "--model", "nowhere/small",
      "--review", "false", "--judge-model", "nowhere/judge",
      "--build-dir", "out/build", "--report", "out/report.json",
    ];
    const module = (file: string) => JSON.stringify(pathToFileURL(join(SRC, file)).href);
    const script = [
      `const { overrideConfig, splitModelSpec } = await import(${module("config.ts")});`,
      `const { runHeadless } = await import(${module("headless.ts")});`,
      // What headlessOptions sets of these options (turri's CLI, through configKeyOptions), set as it sets them.
      `overrideConfig({ harnessModel: splitModelSpec("nowhere/big"), codingModel: splitModelSpec("nowhere/small"), judgeModel: splitModelSpec("nowhere/judge"), review: false });`,
      "const quiet = () => {};",
      // The export as the process exits, a marker line on stderr: what turri's CLI prints there from it, `The code is in <dir> (<module> at <commit>).`
      'const told = (exported, buildDir) => console.error(`exported ${JSON.stringify({ exported, buildDir })}`);',
      "const view = { orphansStopped: quiet, warn: quiet, exported: told, pulseRunning: quiet, pulseFinished: quiet, turnIncident: quiet, planned: quiet,",
      "  canAsk: () => false, ask: async () => undefined, startOverRefused: (message) => console.error(message), nextPulse: quiet, drained: quiet, ended: quiet };",
      `const result = await runHeadless({ plainFile: "app.plain", buildDir: "out/build", report: "out/report.json", command: ${JSON.stringify(command)}, ask: (loop) => loop.bringUp("app.plain") }, view);`,
      "process.exit(result.exitCode);",
    ].join("\n");
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("--start-over");
    const written = JSON.parse(readFileSync(join(dir, "out", "report.json"), "utf8"));
    expect(written.command).toEqual(command);
    expect(written.models).toMatchObject({
      harness: { model: "nowhere/big", thinking: "medium" },
      coding: { model: "nowhere/small", thinking: "low" },
      judge: { model: "nowhere/judge", thinking: "medium" },
    });
    expect(written).toMatchObject({ review: false });
    expect(written).not.toHaveProperty("conformance_tests");
    expect(written.build_dir_export).toMatchObject({ exported: true, module: "app" });
    expect(readdirSync(join(dir, "out", "build"))).toEqual(["main.py"]);
    // The view is told of the export as the process exits - after the run stopped, before the report's last write - with
    // what the CLI's line needs: whether it was exported, the module and its commit (or why not), and the --build-dir.
    const marker = run.stderr.split("\n").find((line) => line.startsWith("exported "));
    expect(run.stderr.indexOf("--start-over")).toBeLessThan(run.stderr.indexOf("exported "));
    const told = JSON.parse(marker!.slice("exported ".length)) as { exported: Record<string, unknown>; buildDir: string };
    const commit = spawnSync("git", ["--git-dir", join(dir, "plain_modules", "app", ".plaingit"), "log", "-1", "--format=%h"], { encoding: "utf8" }).stdout.trim();
    expect(told).toEqual({ exported: { exported: true, dir: join(dir, "out", "build"), module: "app", commit, files: 1 }, buildDir: join(dir, "out", "build") });
    expect(written.build_dir_export).toEqual(told.exported);
    expect(written.outcome).toMatchObject({ status: "incomplete", exit_code: 1, modules: [{ module: "app", state: "start_over_needed" }] });
    expect(written.functionalities.total).toEqual({ specified: 2, with_scenarios: 0, completed: 1, conformance_tested: 0 });
    expect(written.pulses.counts.total).toBe(0);
  });
});

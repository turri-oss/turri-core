import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/regenerate/jobs.ts";
import type { StartOverQuestion } from "../src/work.ts";

/**
 * A run of work through the session's loop (work.ts): what it planned, how it settles a start over, and how it ends -
 * drained, failed, stopped - with its report and export. The agents are scripted; no model is called.
 */

type StubSession = { tools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> };
/** The coding agent builds the app and its unit test and runs them; every other agent answers nothing. */
async function scriptedAgent(session: StubSession, prompt: string): Promise<string> {
  const tool = (name: string) => session.tools.find((candidate) => candidate.name === name);
  if (prompt.includes("Before you finish: call update_notes")) {
    await tool("update_notes")?.execute("id", { changes: [{ section: "where", action: "add", text: "stub agent was here" }] });
    return "Done.";
  }
  if (tool("write") === undefined || tool("run_unit_tests") === undefined) return "";
  await tool("write")!.execute("id", { path: "app.py", content: "print('one')\n" });
  await tool("write")!.execute("id", { path: "test_app.py", content: "import unittest\n\nclass AppTest(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n" });
  await tool("run_unit_tests")!.execute("id", {});
  return "Done.";
}
vi.mock("../src/pi.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/pi.ts")>()),
  createExecutor: vi.fn(async (opts: { customTools?: StubSession["tools"] }) => ({ tools: opts.customTools ?? [], dispose: () => {}, abort: async () => {}, turns: 0 })),
  ask: vi.fn(scriptedAgent),
}));
vi.mock("../src/run-report.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/run-report.ts")>();
  return { ...actual, startRunReport: (options: Parameters<typeof actual.startRunReport>[0]) => actual.startRunReport({ ...options, onExit: false }) };
});

const { runWork } = await import("../src/work.ts");
const { isTurriError } = await import("../src/errors.ts");
const { createJobRegistry } = await import("../src/regenerate/jobs.ts");
const { createWorkLoop, chainSpec } = await import("../src/regenerate/loop.ts");
const { recordHistory } = await import("../src/regenerate/lineage.ts");
const { writeCodeRecord } = await import("../src/regenerate/records.ts");
const { resolveRequiresChain } = await import("../src/regenerate/requires.ts");
const { writeTestScripts } = await import("./test-scripts.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-work-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "review: false\n");
  writeTestScripts(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

function spec(name: string, text: string, requires?: string): string {
  const file = join(dir, `${name}.plain`);
  writeFileSync(file, `${requires !== undefined ? `---\nrequires:\n  - ${requires}\n---\n\n` : ""}***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# ${name}-one\n${text}\n`);
  return file;
}

/** A session's loop and registry, as runWork is given them - every job's end heard, as the session's events tell it. */
function session(ask?: (title: string, body: string) => Promise<boolean | undefined>) {
  const finished = new Set<(job: Job) => void>();
  const jobs = createJobRegistry({ retries: 0, onFinish: (job) => finished.forEach((listener) => listener(job)) });
  const loop = createWorkLoop({ registry: jobs, cwd: dir, planner: false });
  return { loop, jobs, onFinish: (listener: (job: Job) => void) => (finished.add(listener), () => void finished.delete(listener)), ...(ask !== undefined ? { ask } : {}) };
}

describe("a run of work", () => {
  it("lands its pulse and ends completed, its report and export written", async () => {
    const app = spec("app", "Print one.");
    const run = await runWork(session(), "regenerate", { plainFile: app, report: join(dir, "out", "report.json"), exportTo: join(dir, "out", "build") });
    expect(run.planned.map((status) => status.module)).toEqual(["app"]);
    const result = await run.done;
    expect(result).toMatchObject({ status: "completed", failed: [], unfinished: [], exported: { exported: true, module: "app" } });
    expect(result.jobs.map((job) => job.status)).toEqual(["succeeded"]);
    expect(existsSync(join(dir, "out", "build", "app.py"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "out", "report.json"), "utf8"))).toMatchObject({ outcome: { status: "completed" } });
  });

  it("refuses, as a TurriError, a config that does not parse and an export into the project", async () => {
    const app = spec("app", "Print one.");
    await expect(runWork(session(), "regenerate", { plainFile: app, exportTo: dir })).rejects.toSatisfy((error) => isTurriError(error, "refused"));
    writeFileSync(join(dir, "config.turri.yaml"), "models: [\n");
    await expect(runWork(session(), "regenerate", { plainFile: app })).rejects.toSatisfy((error) => isTurriError(error, "config-invalid"));
  });

  it("refuses conformance tests while they are off, and a test plain file asked to be built", async () => {
    const app = spec("app", "Print one.");
    await expect(runWork(session(), "conform", { plainFile: app })).rejects.toSatisfy((error) => isTurriError(error, "refused"));
    mkdirSync(join(dir, "tests", "app"), { recursive: true });
    const tested = join(dir, "tests", "app", "app-one.plain");
    writeFileSync(tested, "---\nmodule: app\nfunc_id: app-one\n---\n\n***conformance tests***\n\n# prints\nIt prints one.\n");
    await expect(runWork(session(), "regenerate", { plainFile: tested })).rejects.toSatisfy((error) => isTurriError(error, "refused"));
  });

  it("ends incomplete at a codebase it would have to start over, unless told to or the person agrees", async () => {
    spec("base", "Base one.");
    const app = spec("app", "App one.");
    const code = join(dir, "plain_modules", "app", "code");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "main.py"), "print(1)\n");
    writeCodeRecord(code, chainSpec(resolveRequiresChain(app, [], undefined, { allowNoFunctionalities: true })).tree);
    recordHistory(code, "app pulse 1 landed");
    spec("app", "App one.", "base");

    const unasked = await (await runWork(session(), "regenerate", { plainFile: app })).done;
    expect(unasked).toMatchObject({ status: "incomplete", jobs: [] });
    expect(unasked.reason).toContain("was built without base");

    const asked: string[] = [];
    const declined = await (await runWork(session(async (title) => (asked.push(title), false)), "regenerate", { plainFile: app, startOver: "ask" })).done;
    expect(asked).toEqual(["Start over?"]);
    expect(declined.status).toBe("incomplete");

    const run = await runWork(session(), "regenerate", { plainFile: app, startOver: true });
    expect(run.planned.some((status) => status.startOver !== undefined)).toBe(false);
    expect((await run.done).status).toBe("completed");
  });

  it("puts a start over to the run's own answerer - yes starts over, no regenerates the rest, no answer ends it at once", async () => {
    spec("base", "Base one.");
    const app = spec("app", "App one.");
    const code = join(dir, "plain_modules", "app", "code");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "main.py"), "print(1)\n");
    writeCodeRecord(code, chainSpec(resolveRequiresChain(app, [], undefined, { allowNoFunctionalities: true })).tree);
    recordHistory(code, "app pulse 1 landed");
    spec("app", "App one.", "base");
    const said: StartOverQuestion[] = [];
    const answering = (answer: boolean | undefined) => async (question: StartOverQuestion) => (said.push(question), answer);

    // No answer: nothing more runs - the person's "no" is not guessed.
    const unanswered = await (await runWork(session(), "regenerate", { plainFile: app, startOver: answering(undefined) })).done;
    expect(said[0]).toMatchObject({ title: "Start over?", codebases: ["app"] });
    expect(said[0]!.body).toContain("was built without base");
    expect(unanswered).toMatchObject({ status: "incomplete", jobs: [] });
    expect(unanswered.reason).toContain("Nobody answered");

    // No - as `false` given outright too: the run drains what else there is, and ends with app left as it is.
    for (const no of [answering(false), false] as const) {
      const declined = await (await runWork(session(), "regenerate", { plainFile: app, startOver: no })).done;
      expect(declined).toMatchObject({ status: "incomplete", unfinished: [{ module: "app", state: "start_over_needed" }] });
      expect(declined.reason).toBeUndefined();
    }

    // Yes: started over, then built.
    const run = await runWork(session(), "regenerate", { plainFile: app, startOver: answering(true) });
    expect(run.planned.some((status) => status.startOver !== undefined)).toBe(false);
    expect((await run.done).status).toBe("completed");
  });

  it("says why a pulse that stopped at its unit tests did not land, from its details", async () => {
    const app = spec("app", "Print one.");
    const jobs = createJobRegistry({ retries: 1 });
    const loop = createWorkLoop({ registry: jobs, cwd: dir, planner: false, run: async () => ({ landed: false, report: "Its unit tests never passed.", stoppedAt: "unit tests" }) });
    const result = await (await runWork({ loop, jobs, onFinish: () => () => {} }, "regenerate", { plainFile: app })).done;
    expect(result.jobs[0]).toMatchObject({ status: "failed", details: { passed: false, landed: false, stoppedAt: "unit tests" } });
    expect(loop.mapPlan().codebases[0]?.stuck?.cause).toBe("its unit tests never passed");
  });

  it("ends stopped when its signal is aborted, what was running rolled back", async () => {
    const app = spec("app", "Print one.");
    const controller = new AbortController();
    const run = await runWork(session(), "regenerate", { plainFile: app, signal: controller.signal });
    controller.abort();
    const result = await run.done;
    expect(result.status).toBe("stopped");
    expect(existsSync(join(dir, "plain_modules", "app", "code", "app.py"))).toBe(false);
  });
});

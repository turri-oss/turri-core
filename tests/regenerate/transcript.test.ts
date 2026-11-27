import { describe, expect, it } from "vitest";
import { describeUsage, reportSpec, reportStage, reportTranscript, reportUsage } from "../../src/regenerate/activity.ts";
import { createJobRegistry, describeJob } from "../../src/regenerate/jobs.ts";

async function jobWith(run: () => void) {
  const jobs = createJobRegistry();
  const job = jobs.start({ kind: "render", summary: "app.plain fs 1", run: async () => (run(), { report: "" }) });
  await jobs.wait(job.id);
  return job;
}

describe("what a job spends", () => {
  it("adds up every model response", async () => {
    const job = await jobWith(() => {
      reportUsage({ input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0, cost: 0.02 });
      reportUsage({ input: 500, output: 300, cacheRead: 6000, cacheWrite: 0, cost: 0.03 });
    });
    expect(job.usage).toEqual({ input: 1500, output: 500, cacheRead: 11000, cacheWrite: 0, cost: 0.05 });
    expect(describeUsage(job.usage)).toBe("13.0k tok · $0.05");
  });

  it("says nothing before anything is spent", () => {
    expect(describeUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })).toBe("");
  });
});

describe("a job's transcript", () => {
  it("joins the deltas of one reply, and keeps stages, prompts, tool calls and results in order", async () => {
    const job = await jobWith(() => {
      reportStage("app 1: writing code and unit tests");
      reportTranscript({ kind: "prompt", text: "Implement functionality 1." });
      reportTranscript({ kind: "thinking", text: "Start " });
      reportTranscript({ kind: "thinking", text: "with the model." });
      reportTranscript({ kind: "tool", text: 'write {"path":"app.py"}' });
      reportTranscript({ kind: "result", text: "Wrote app.py" });
      reportTranscript({ kind: "text", text: "Done, " });
      reportTranscript({ kind: "text", text: "tests pass." });
    });
    expect(job.transcript.map((e) => [e.kind, e.text])).toEqual([
      ["stage", "app 1: writing code and unit tests"],
      ["prompt", "Implement functionality 1."],
      ["thinking", "Start with the model."],
      ["tool", 'write {"path":"app.py"}'],
      ["result", "Wrote app.py"],
      ["text", "Done, tests pass."],
    ]);
  });

  it("keeps a long run's transcript bounded, dropping the oldest", async () => {
    const job = await jobWith(() => {
      for (let i = 0; i < 400; i += 1) reportTranscript({ kind: i % 2 ? "result" : "tool", text: `${i} ${"x".repeat(2000)}` });
    });
    const size = job.transcript.reduce((sum, e) => sum + e.text.length, 0);
    expect(size).toBeLessThanOrEqual(600_000);
    expect(job.transcript.at(-1)!.text.startsWith("399 ")).toBe(true);
  });
});

describe("the functional spec a job is building", () => {
  const spec = {
    spec: { module: "rt_tuples", funcId: "tuple-arithmetic" },
    label: "rt_tuples functionality 2 of 5",
    text: "A :Tuple: supports arithmetic.\n  - Adding two tuples adds each component.\n\nacceptance tests:\n- (3, -2, 5, 1) + (-2, 3, 1, 0) is (1, 1, 6, 1).",
  };

  it("names the spec it is building and records the full text in its transcript", async () => {
    const jobs = createJobRegistry();
    let release = () => {};
    const job = jobs.start({
      kind: "render",
      summary: "rt_tuples.plain module",
      run: async () => {
        reportSpec(spec);
        reportStage("rt_tuples 2: turri is writing the code and its unit tests");
        await new Promise<void>((done) => (release = done));
        return { report: "" };
      },
    });
    await new Promise((done) => setTimeout(done, 10));

    // Which functional spec, as data - for a host to light it without reading the label.
    expect(job.building!.spec).toEqual({ module: "rt_tuples", funcId: "tuple-arithmetic" });

    // And whole in its transcript - what its log streams - where it began.
    const built = job.transcript.find((entry) => entry.kind === "spec");
    expect(built?.text.startsWith("rt_tuples functionality 2 of 5")).toBe(true);
    expect(built?.text).toContain("Adding two tuples adds each component.");
    expect(describeJob(job)).toContain("building rt_tuples functionality 2 of 5:");
    release();
    await jobs.wait(job.id);
  });
});

describe("the spec text shown for a functionality", () => {
  it("names its module and func-id as data, and carries its scenarios of both kinds, each under its id, which the conformance tests carry out", async () => {
    const { buildingSpec } = await import("../../src/regenerate/conformance.ts");
    const specifications = {
      "functional specs": ["One.", "A :Tuple: supports arithmetic."],
      conformance_tests: [{ id: "subtracts", text: "2 - 1 is 1." }],
      acceptance_tests: [{ id: "adds", text: "1 + 1 is 2." }],
    };
    expect(buildingSpec("rt_tuples", "tuple-arithmetic", 5, specifications as never)).toEqual({
      spec: { module: "rt_tuples", funcId: "tuple-arithmetic" },
      label: "rt_tuples:tuple-arithmetic, functional spec of 5",
      text: "A :Tuple: supports arithmetic.\n\nconformance tests:\n# subtracts\n2 - 1 is 1.\n\nacceptance tests:\n# adds\n1 + 1 is 2.",
    });
  });
});

describe("how long the job has been on what it is building now", () => {
  it("keeps its clock when the same functionality goes on to its next stage, and starts a new one for the next", async () => {
    const released: Array<() => void> = [];
    const hold = () => new Promise<void>((resolve) => released.push(resolve));
    const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
    const jobs = createJobRegistry();
    const job = jobs.start({
      kind: "regenerate",
      summary: "m",
      run: async () => {
        reportSpec({ label: "app functionality 1 of 2", text: "one" });
        await hold();
        reportSpec({ label: "app functionality 1 of 2", text: "one, with its acceptance tests" });
        await hold();
        reportSpec({ label: "app functionality 2 of 2", text: "two" });
        return { report: "" };
      },
    });
    await tick();
    const first = job.building!.since!;
    released.shift()!();
    await tick();
    // Its conformance stage: the same functionality, the same clock.
    expect(job.building!.text).toBe("one, with its acceptance tests");
    expect(job.building!.since).toBe(first);
    released.shift()!();
    await jobs.wait(job.id);
    expect(job.building!.label).toBe("app functionality 2 of 2");
    expect(job.building!.since!).toBeGreaterThan(first);
  });

  it("reads in hours once it passes one", async () => {
    const { formatElapsed } = await import("../../src/regenerate/jobs.ts");
    expect(formatElapsed(35 * 60_000)).toBe("35m 0s");
    expect(formatElapsed(3 * 3_600_000 + 5 * 60_000)).toBe("3h 5m");
  });
});

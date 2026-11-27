import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSkillOptions } from "../src/genome.ts";
import type { SkillReport } from "../src/session.ts";

/**
 * A skill run through the session (`skills.run`), outside any chat: which skill it runs, and what it says of it. No
 * agent runs: the skill's run is a stand-in that says it ran each step and leaves an artifact.
 */

const runs: RunSkillOptions[] = [];
vi.mock("../src/genome.ts", async (actual) => ({
  ...(await actual<typeof import("../src/genome.ts")>()),
  runSkill: async (options: RunSkillOptions) => {
    runs.push(options);
    const { report } = options;
    report.step("draft", 1);
    report.livePass?.("draft", "the opening", 1);
    report.artifact("draft.md", "the draft");
    report.liveReview?.("draft", 1, 0);
    report.gate("draft", 2);
    report.judge(0, "p/judge", "pass", 0);
    report.judge(1, "p/judge", "no verdict", 0);
    report.outcome("draft", "retry", "Judge 2 gave no verdict.");
    report.step("draft", 2);
    report.gate("draft", 0);
    report.outcome("draft", "abort", "No artifact.");
    return { ok: false, artifacts: { "draft.md": "the draft" }, output: "the draft" };
  },
}));

const { createTurri } = await import("../src/session.ts");
const { isTurriError } = await import("../src/errors.ts");

let dir: string;
let cwd: string;
beforeEach(() => {
  runs.length = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-session-skills-")));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.turri.yaml"), "sentinel: false\n");
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const code = (expected: string) => (error: unknown) => isTurriError(error, expected as never);

/** A skill in a folder of its own, outside the project's skill folders: one step, `draft`. */
function skillFolder(name: string, frontmatter = `name: ${name}\ndescription: Draft a thing.`): string {
  const folder = join(dir, "own", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), `---\n${frontmatter}\n---\n\n## Steps\n\n### draft\nWrite the draft.\n`);
  return folder;
}

/** The same skill, its draft gated: two judges, all to pass, tried again twice, a reviewer reading along. */
const GATED = [
  "name: drafting",
  "description: Draft a thing.",
  "metadata:",
  "  gates:",
  "    - after: draft",
  "      review: { rubric: rubrics/draft.md, judges: 2, quorum: all, on_fail: retry, max_retries: 2 }",
  "      continuous: { rubric: rubrics/live.md, judges: 1 }",
].join("\n");

describe("what a skill run says", () => {
  it("says the skill's steps and gates as it starts, then each step, artifact, review, verdict and decision in order", async () => {
    skillFolder("drafting", GATED);
    const turri = await createTurri();
    try {
      const said: SkillReport[] = [];
      await turri.skills.run({ dir: "own/drafting" }, { onReport: (report) => said.push(report) });
      const gate = { rubric: "rubrics/draft.md", judges: 2, quorum: "all", onFail: "retry", maxRetries: 2, continuous: { rubric: "rubrics/live.md", judges: 1 } };
      expect(said).toEqual([
        { kind: "start", skill: "drafting", steps: [{ name: "draft", gate }] },
        { kind: "step", step: "draft", attempt: 1 },
        { kind: "livePass", step: "draft", scope: "the opening", findings: 1 },
        { kind: "artifact", step: "draft", path: "draft.md", body: "the draft" },
        { kind: "liveReview", step: "draft", passes: 1, findings: 0 },
        { kind: "gate", step: "draft", judges: 2 },
        { kind: "judge", step: "draft", judge: 0, model: "p/judge", verdict: "pass", violations: 0 },
        { kind: "judge", step: "draft", judge: 1, model: "p/judge", verdict: "none", violations: 0 },
        { kind: "outcome", step: "draft", decision: "retry", critique: "Judge 2 gave no verdict." },
        { kind: "step", step: "draft", attempt: 2 },
        { kind: "gate", step: "draft", judges: 0 },
        { kind: "outcome", step: "draft", decision: "abort", critique: "No artifact." },
      ]);
    } finally {
      await turri.dispose();
    }
  });

  it("goes on when the caller's listener throws, the throw a warning", async () => {
    skillFolder("drafting");
    const warned: string[] = [];
    const warn = (warning: Error) => void warned.push(warning.message);
    process.on("warning", warn);
    const turri = await createTurri();
    try {
      const result = await turri.skills.run({ dir: "own/drafting" }, { onReport: () => { throw new Error("drawn badly"); } });
      expect(result.output).toBe("the draft");
      await new Promise((resolve) => setImmediate(resolve));
      expect(warned).toContain("drawn badly");
    } finally {
      process.off("warning", warn);
      await turri.dispose();
    }
  });

  it("lists each skill with its steps and gates", async () => {
    const turri = await createTurri();
    try {
      const skills = turri.skills.list();
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) expect(skill.steps.every((step) => typeof step.name === "string")).toBe(true);
      expect(skills.some((skill) => skill.steps.some((step) => step.gate !== undefined && step.gate.judges > 0))).toBe(true);
    } finally {
      await turri.dispose();
    }
  });
});

describe("a skill run outside any chat", () => {
  it("runs the skill in a folder, named from the project's folder, as it runs one of the catalogue's by name", async () => {
    skillFolder("drafting");
    const turri = await createTurri();
    try {
      const result = await turri.skills.run({ dir: "own/drafting" });
      expect(result).toMatchObject({ ok: false, output: "the draft" });
      expect(runs[0]!.skillDir).toBe(join(dir, "own", "drafting"));
      // Not in the catalogue: a folder is not a name.
      await expect(turri.skills.run("drafting")).rejects.toSatisfy(code("not-found"));
    } finally {
      await turri.dispose();
    }
  });

  it("refuses a folder with no SKILL.md as not found, and one that does not parse with why", async () => {
    skillFolder("nameless", "description: no name.");
    const turri = await createTurri();
    try {
      await expect(turri.skills.run({ dir: "own/missing" })).rejects.toSatisfy(code("not-found"));
      await expect(turri.skills.run({ dir: "own/nameless" })).rejects.toSatisfy((error: unknown) => isTurriError(error, "refused") && /name/.test((error as Error).message));
      expect(runs).toEqual([]);
    } finally {
      await turri.dispose();
    }
  });
});

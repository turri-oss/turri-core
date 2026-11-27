import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSkillOptions } from "../src/genome.ts";

/**
 * A skill run through the session (`skills.run`), outside any chat: which skill it runs, and what it says of it. No
 * agent runs: the skill's run is a stand-in that says it ran each step and leaves an artifact.
 */

const runs: RunSkillOptions[] = [];
vi.mock("../src/genome.ts", async (actual) => ({
  ...(await actual<typeof import("../src/genome.ts")>()),
  runSkill: async (options: RunSkillOptions) => {
    runs.push(options);
    options.report.step("draft", 1);
    options.report.artifact("draft.md", "the draft");
    return { ok: true, artifacts: { "draft.md": "the draft" }, output: "the draft" };
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

describe("a skill run outside any chat", () => {
  it("runs the skill in a folder, named from the project's folder, as it runs one of the catalogue's by name", async () => {
    skillFolder("drafting");
    const turri = await createTurri();
    try {
      const result = await turri.skills.run({ dir: "own/drafting" });
      expect(result).toMatchObject({ ok: true, output: "the draft" });
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

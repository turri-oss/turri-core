import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({ models: [] as string[], regions: [] as Array<string | undefined> }));
vi.mock("../src/model-check.ts", async (original) => ({
  ...(await original<typeof import("../src/model-check.ts")>()),
  piModelAccess: async () => ({}),
  checkModels: async (used: Array<{ spec: string; usedBy: string[] }>) => {
    asked.models.push(...used.map((model) => model.spec));
    asked.regions.push(process.env.AWS_REGION);
    return used.map((model) => ({ ...model, ok: true, ms: 100 }));
  },
}));

const { doctor } = await import("../src/api/system.ts");

/** doctor as a host runs it: the checks returned, for its own UI - never printed, never asked. */

describe("doctor for a host", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "turri-doctor-host-"));
    asked.models = [];
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: anthropic/claude-test\ncoding-model: anthropic/claude-test\n");
    writeFileSync(join(project, "game.plain"), "***implementation reqs***\n\n- :Implementation: is written in Zig.\n\n***functional specs***\n\n# draw\nDraw.\n");
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("checks the project it is given, not the folder it runs in - and without one, only the machine", async () => {
    const checks = await doctor({ dir: project, env: { PATH: "" } });
    expect(checks.find((check) => check.name === "game")).toMatchObject({ level: "missing", detail: expect.stringContaining("Zig") });
    expect(process.cwd()).not.toBe(project);
    const machine = await doctor({ env: { PATH: "" } });
    expect(machine.map((check) => check.name)).toEqual(["Node", "bash", "git", "OS sandbox", "Model provider"]);
  });

  it("says a config that does not parse first - a key set twice, its line - and that none of it applies", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: anthropic/claude-test\nconformance-tests: true\nconformance-tests: false\n");
    const checks = await doctor({ dir: project, env: { PATH: "" } });
    expect(checks.find((check) => check.name === "Config")).toMatchObject({
      level: "missing",
      detail: "config.turri.yaml, line 3: conformance-tests is set twice",
      more: [expect.stringContaining("none of config.turri.yaml applies")],
      fix: "Set each key once in config.turri.yaml, then run turri doctor again",
    });
  });

  it("calls Bedrock models in the region they need, set as a session sets it - none being open", async () => {
    writeFileSync(join(project, "config.turri.yaml"), "harness-model: amazon-bedrock/eu.anthropic.claude-opus-5-5\ncoding-model: amazon-bedrock/eu.anthropic.claude-haiku-5-5\n");
    const aws = ["AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "AWS_CONFIG_FILE", "TURRI_AWS_REGION"];
    const kept = Object.fromEntries(aws.map((name) => [name, process.env[name]]));
    for (const name of aws) delete process.env[name];
    process.env.AWS_CONFIG_FILE = join(project, "no-aws-config");
    asked.regions = [];
    try {
      await doctor({ dir: project, models: true, env: { PATH: "" } });
      expect(asked.regions).toEqual(["eu-central-1"]);
    } finally {
      for (const name of aws) {
        if (kept[name] === undefined) delete process.env[name];
        else process.env[name] = kept[name];
      }
    }
  });

  it("writes nothing to stdout, even asking the models", async () => {
    const write = vi.spyOn(process.stdout, "write");
    const log = vi.spyOn(console, "log");
    await doctor({ dir: project, models: true });
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("looks for git on the PATH of the environment it is given", async () => {
    const empty = join(project, "bin");
    mkdirSync(empty);
    const checks = await doctor({ env: { PATH: empty } });
    expect(checks.find((check) => check.name === "git")).toMatchObject({ level: "missing", fix: expect.stringContaining("install git") });
    expect(checks.find((check) => check.name === "git")?.fix).not.toMatch(/\u001b\[/);
  });

  it("asks the models only when told to - it costs money", async () => {
    const checks = await doctor({ dir: project });
    expect(asked.models).toEqual([]);
    expect(checks.some((check) => check.name.includes("harness-model"))).toBe(false);
    const withModels = await doctor({ dir: project, models: true });
    expect(asked.models).toEqual(["anthropic/claude-test"]);
    expect(withModels.find((check) => check.name === "harness-model, coding-model")).toMatchObject({ level: "ok" });
  });
});

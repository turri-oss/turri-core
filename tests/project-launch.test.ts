import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchAgentInput } from "../src/launch-agent.ts";

/**
 * A launch of a project's own, with no session (`launchModule`, /project). No model is called: the launch agent is a
 * stand-in that notes the model it was given and the AWS region it would call it in, and comes up.
 */

const called = vi.hoisted(() => [] as Array<{ model?: string; region?: string }>);
vi.mock("../src/launch-agent.ts", () => ({
  runLaunchAgent: async (input: LaunchAgentInput) => {
    called.push({ ...(input.model !== undefined ? { model: input.model } : {}), ...(process.env.AWS_REGION !== undefined ? { region: process.env.AWS_REGION } : {}) });
    return { launched: true, summary: "runs" };
  },
}));

const { launchModule } = await import("../src/api/project.ts");
const { recordHistory } = await import("../src/regenerate/lineage.ts");
const { writePlain } = await import("./test-plain.ts");

const AWS = ["AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "AWS_CONFIG_FILE", "TURRI_AWS_REGION"];
let dir: string;
let kept: Record<string, string | undefined>;
beforeEach(() => {
  called.length = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-project-launch-")));
  kept = Object.fromEntries(AWS.map((name) => [name, process.env[name]]));
  for (const name of AWS) delete process.env[name];
  process.env.AWS_CONFIG_FILE = join(dir, "no-aws-config");
});
afterEach(() => {
  for (const name of AWS) {
    if (kept[name] === undefined) delete process.env[name];
    else process.env[name] = kept[name];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("a launch with no session", () => {
  it("calls its Bedrock model in the region it needs, set as a session sets it", async () => {
    writeFileSync(join(dir, "config.turri.yaml"), "coding-model: amazon-bedrock/eu.anthropic.claude-haiku-5-5\nsentinel: false\n");
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Python.\n\n***functional specs***\n\n# greet\napp greets.\n");
    const code = join(dir, "plain_modules", "app", "code");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "app.py"), "print('hello')\n");
    recordHistory(code, "p1");
    const launch = await launchModule("app.plain", { cwd: dir });
    expect(launch.status).toBe("launched");
    expect(called).toEqual([{ model: "amazon-bedrock/eu.anthropic.claude-haiku-5-5", region: "eu-central-1" }]);
  });
});

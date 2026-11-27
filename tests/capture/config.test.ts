import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureConfig } from "../../src/capture/config.ts";
import { CONFIG_FILE, configFileProblem, projectModels, readProjectConfig } from "../../src/config.ts";
import { initConfig } from "../../src/init-config.ts";

/** The captured project's config, as a capture stopped part-way goes on: the models the source has now, the rest its own. */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turri-capture-config-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const astra = "amazon-bedrock/global.openai.gpt-6-astra";
const luna = "amazon-bedrock/global.openai.gpt-6-luna";

/** What a capture started on US Bedrock Claude saved before it stopped: its scripts and settings, a role's turn limit. */
const SAVED = [
  "# Written by turri capture.",
  "# Every key is in turri's docs/config.md.",
  "harness-model: amazon-bedrock/us.anthropic.claude-opus-5-5:medium",
  "coding-model: amazon-bedrock/us.anthropic.claude-haiku-5-5:low",
  "module: kept.plain",
  "conformance-tests: true",
  "unittests-script: test_scripts/run_unittests_python.sh",
  "conformance-tests-script: test_scripts/run_conformance_tests_python.sh",
  "models:",
  "  capture-exploration: amazon-bedrock/us.anthropic.claude-haiku-5-5:low",
  "#   default: custom/default",
  "",
  "  capture-analysis: amazon-bedrock/us.anthropic.claude-sonnet-5-5:low",
  "  capture: { model: amazon-bedrock/us.anthropic.claude-opus-5-5, thinking: medium, turn-limit: 280 }",
  "  coding: { model: amazon-bedrock/us.anthropic.claude-haiku-5-5, thinking: low, turn-limit: 180 }",
  "  reviewer: custom/reviewer:high",
  "",
].join("\n");

describe("a resumed capture's config", () => {
  it("takes the source project's current models in place, keeping its scripts, settings and turn limits", async () => {
    const source = join(dir, "source");
    mkdirSync(source);
    await initConfig(source, { vendor: "amazon-bedrock", bedrock: { maker: "openai", region: "global" } });

    const text = await captureConfig(join(source, CONFIG_FILE), {}, SAVED);
    const plain = join(dir, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, CONFIG_FILE), text);

    expect(configFileProblem(join(plain, CONFIG_FILE))).toBeUndefined();
    const config = readProjectConfig(plain);
    // models.coding wins over coding-model, so it is the one set.
    expect(projectModels(config)).toMatchObject({ harness: { model: astra, thinking: "medium" }, coding: { model: luna, thinking: "low" } });
    expect(config.models).toMatchObject({
      "capture-exploration": { model: luna, thinking: "low" },
      "capture-analysis": { model: luna, thinking: "low" },
      capture: { model: astra, thinking: "medium", turnLimit: 280 },
      coding: { model: luna, thinking: "low", turnLimit: 180 },
      reviewer: { model: "custom/reviewer", thinking: "high" },
    });
    expect(config).toMatchObject({
      module: "kept.plain",
      conformanceTests: true,
      unittestsScript: "test_scripts/run_unittests_python.sh",
      conformanceTestsScript: "test_scripts/run_conformance_tests_python.sh",
    });
    // Edited, not written again: the capture's own header stays.
    expect(text.startsWith("# Written by turri capture.\n# Every key is in turri's docs/config.md.\n")).toBe(true);
  });

  it("lets models named on the command line win over the source project's, as they do on a fresh capture", async () => {
    const source = join(dir, "source");
    mkdirSync(source);
    await initConfig(source, { vendor: "amazon-bedrock", bedrock: { maker: "openai", region: "global" } });

    const text = await captureConfig(join(source, CONFIG_FILE), { harnessModel: "p/talk:high", codingModel: "p/code:low" }, SAVED);
    const plain = join(dir, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, CONFIG_FILE), text);
    const config = readProjectConfig(plain);
    expect(projectModels(config)).toMatchObject({ harness: { model: "p/talk", thinking: "high" }, coding: { model: "p/code", thinking: "low" } });
    // The capture tiers have no flag of their own: they follow the source project's init-config.
    expect(config.models).toMatchObject({ "capture-exploration": { model: luna }, capture: { model: astra, turnLimit: 280 } });
  });

  it("is left as it was when the source project has no config.turri.yaml to read models from", async () => {
    expect(await captureConfig(undefined, {}, SAVED)).toBe(SAVED);
  });
});

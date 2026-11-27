import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configOverrides, dropConfigOverride, projectModels, readProjectConfig, setConfigOverrides, splitModelSpec } from "../src/config.ts";

/** A session's own values for config keys: read in its project as config.turri.yaml's, and nowhere else. */

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-overrides-")));
  mkdirSync(join(dir, "project", "sub"), { recursive: true });
  writeFileSync(join(dir, "project", "config.turri.yaml"), "coding-model: p/file:low\nreview: true\n");
});
afterEach(() => {
  setConfigOverrides(join(dir, "project"), undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe("a session's config overrides", () => {
  it("hold in its project and the folders below it, not beside it, until cleared", () => {
    const project = join(dir, "project");
    setConfigOverrides(project, { codingModel: splitModelSpec("p/given:high"), review: false });
    expect(readProjectConfig(project)).toMatchObject({ codingModel: { model: "p/given", thinking: "high" }, review: false });
    expect(configOverrides(join(project, "sub")).review).toBe(false);
    expect(configOverrides(dir)).toEqual({});
    setConfigOverrides(project, undefined);
    expect(readProjectConfig(project)).toMatchObject({ codingModel: { model: "p/file", thinking: "low" }, review: true });
  });

  it("take their key's place, so a models: entry still wins over them", () => {
    const project = join(dir, "project");
    writeFileSync(join(project, "config.turri.yaml"), "coding-model: p/file:low\nmodels:\n  coding: p/entry:medium\n");
    setConfigOverrides(project, { codingModel: splitModelSpec("p/given:high") });
    expect(projectModels(readProjectConfig(project)).coding).toEqual({ model: "p/entry", thinking: "medium" });
  });

  it("give way one key at a time, as the person sets that key", () => {
    const project = join(dir, "project");
    setConfigOverrides(project, { codingModel: splitModelSpec("p/given"), review: false });
    dropConfigOverride(join(project, "sub"), "codingModel");
    expect(configOverrides(project)).toEqual({ review: false });
  });
});

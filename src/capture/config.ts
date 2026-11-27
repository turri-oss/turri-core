import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CONFIG_FILE, CONFIG_KEYS, configFileProblem, modelSpec, projectConfigFile, projectModels, readConfigFile, splitModelSpec } from "../config.ts";
import { quickStartForCapture } from "../init-config.ts";
import { currentValue, shownValue, withSetting } from "../config-edit.ts";
import { isProjectDir } from "../regenerate/paths.ts";
import { CAPTURE_ROLES } from "./models.ts";

/**
 * The captured project's config. It starts as the config in use where the capture was started - the person's models,
 * thinking, reviews, limits and every other setting they chose - so the capture's own agents, its testing scripts and
 * every pulse after it run as they asked, never on a default they did not choose. What belongs to the original project
 * alone is left out - its module, its testing scripts, its base folder, its test folder - since the capture writes its
 * own. Then the capture's own settings over it: conformance tests on, the models given for it.
 */

/** The keys of a config in use that name the original project's own things: never carried into a capture. */
const ORIGINAL_ONLY = [CONFIG_KEYS.module, CONFIG_KEYS.testDir, CONFIG_KEYS.baseFolder, CONFIG_KEYS.unittestsScript, CONFIG_KEYS.conformanceTestsScript, CONFIG_KEYS.prepareEnvironmentScript];

/** The config file in use for a folder: the nearest folder upwards that is a project's, its config.turri.yaml - or none. */
export function configInUse(dir: string): string | undefined {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (isProjectDir(at)) {
      const file = join(at, projectConfigFile(at));
      return existsSync(file) ? file : undefined;
    }
    if (dirname(at) === at) return undefined;
  }
}

/** Why the config in use cannot be started from - it does not parse - or undefined. */
export function configInUseProblem(file: string | undefined): string | undefined {
  if (file === undefined) return undefined;
  const problem = configFileProblem(file);
  return problem === undefined ? undefined : `${problem} (${file}). A capture starts from the config in use - its models among it - and this one does not parse: fix it - each key set once - then capture again.`;
}

/**
 * Start from the config in use. On resume, keep the capture's own settings (including any scripts already written)
 * but take the project and capture models from the current source config, which may have been initialised since.
 */
export async function captureConfig(source: string | undefined, given: { harnessModel?: string; codingModel?: string }, saved?: string): Promise<string> {
  const project = source !== undefined && basename(source) === CONFIG_FILE ? source : undefined;
  let text: string;
  if (saved === undefined) {
    const carried = project !== undefined ? readFileSync(project, "utf8") : "";
    text = carried || await quickStartForCapture(splitModelSpec(given.harnessModel).model, splitModelSpec(given.codingModel).model);
    for (const key of ORIGINAL_ONLY) text = withSetting(text, key, undefined);
    text = withSetting(text, CONFIG_KEYS.conformanceTests, true);
    const header = [
      "# Written by turri capture.",
      ...(carried !== "" ? [`# It started as the config in use where the capture was started - ${source} - without what was that project's own:`, "# its module, testing scripts, base folder and test folder."] : []),
      "# Every key is in turri's docs/config.md.",
    ];
    text = `${header.join("\n")}\n${text.replace(/^\s*\n/, "")}`;
  } else text = saved;

  const refreshed = saved !== undefined && project !== undefined ? readConfigFile(project) : undefined;
  const pair = projectModels(refreshed ?? {});
  // Write where the setting takes effect: under models: if that role overrides the top-level key.
  const set = (role: "chat" | "coding", key: string, value: string | undefined) => {
    if (value === undefined) return;
    const target = currentValue(text, `models.${role}`) !== undefined ? `models.${role}` : key;
    // Naming the same model without a level keeps its configured thinking; an explicit level wins.
    const current = shownValue(currentValue(text, target));
    const spec = splitModelSpec(value);
    if (current === value || (spec.thinking === undefined && splitModelSpec(current).model === spec.model)) return;
    text = withSetting(text, target, value);
  };
  set("chat", CONFIG_KEYS.harnessModel, given.harnessModel ?? modelSpec(pair.harness));
  set("coding", CONFIG_KEYS.codingModel, given.codingModel ?? modelSpec(pair.coding));
  for (const role of CAPTURE_ROLES) {
    const value = modelSpec(refreshed?.models?.[role]);
    const key = `models.${role}`;
    if (value !== undefined && currentValue(text, key) !== value) text = withSetting(text, key, value);
  }
  return text;
}

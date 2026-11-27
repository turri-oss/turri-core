import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { PACKAGE_ROOT } from "./environment.ts";
import { loadRules } from "./rules.ts";
import { adoptLegacyConfig, AGENT_ROLES, CONFIG_FILE, moduleConfigFile, moduleConfigFileIn, moduleConfigsOf, projectConfigFile, splitModelSpec, THINKING_LEVELS, type AgentRole } from "./config.ts";
import { TurriError } from "./errors.ts";

/**
 * `/settings`' and the chat's settings tool's side of config.turri.yaml: every setting turri reads, what it takes - a yes or no, one of a few words, a
 * number, a model, a list - and when a change to it takes effect, so the person knows whether to wait for the next
 * pulse or not at all. A change is written into the file line by line, its comments and the commented-out examples
 * kept; `models:` and `agent-env:`, which nest, are written again whole, their own comments lost.
 */

/** When a change takes effect. Nothing turri reads needs a restart: what is fixed at its start is changed live. */
export type Effect = "now" | "next-message" | "next-pulse" | "next-plan" | "next-test-run" | "next-landing" | "next-regenerate" | "next-start";

export type SettingKind = "boolean" | "choice" | "number" | "model" | "list" | "path";

/** A role with an entry of its own under `models:` - each agent role, and `default`, which the others take. */
export type ModelRole = "default" | AgentRole;

/**
 * What each setting takes, by its key as config.turri.yaml writes it: a model as provider/model-id with an optional
 * `:thinking`, a path from the project root, a list as YAML's.
 */
export type SettingValues = {
  "harness-model": string;
  "coding-model": string;
  "judge-model": string;
  module: string;
  review: boolean;
  "mutation-testing": boolean;
  "allow-to-stop-jobs": boolean;
  "launch-after-pulse": boolean;
  sentinel: boolean | "ask";
  "conformance-tests": boolean;
  "test-dir": string;
  "base-folder": string;
  "unittests-script": string;
  "conformance-tests-script": string;
  "prepare-environment-script": string;
  "testing-scripts-run-on": "in-place" | "copy";
  "parallel-jobs": number;
  "max-specs-per-pulse": number;
  "max-lines-per-pulse": number;
  "turn-limit": number;
  "compact-at": number;
  "rules-off": string[];
  "agent-env.files": string[];
  "agent-env.vars": string[];
  toolchains: string[];
  debug: boolean;
  "cache-keep": number;
  "ledger-keep": number;
} & { [R in ModelRole as `models.${R}`]: string } & { [R in ModelRole as `models.${R}.turn-limit`]: number };

/** A setting, by its key as config.turri.yaml writes it. */
export type SettingKey = keyof SettingValues;

/** The kinds a setting's value can be read as. */
type KindOf<V> = [V] extends [boolean] ? "boolean" : [V] extends [number] ? "number" : [V] extends [readonly string[]] ? "list" : "model" | "path" | "choice";

/** A setting of the table, its kind the one its value takes. */
type Entry<K extends SettingKey> = Omit<Setting, "key" | "kind"> & { kind: KindOf<SettingValues[K]> };

export interface Setting {
  /** As written in the file - a nested one by its path: `models.coding`, `models.coding.turn-limit`, `agent-env.files`. */
  key: SettingKey;
  /** What it does, in a line. */
  about: string;
  kind: SettingKind;
  /** What it is when it is not set. */
  unset: string;
  effect: Effect;
  /** The words it takes (choice), or the values offered first (number, list). */
  options?: string[];
  /** The least a number may be. */
  min?: number;
  /** Set in the project's config.turri.yaml only: a module's config.turri.<module>.yaml does not change it. */
  projectOnly?: boolean;
  /**
   * Changed by the person alone, with /settings: the chat's settings tool refuses it. What it decides is theirs - turning
   * conformance tests on doubles each change - or it widens what the agents reach (credentials, folders past the
   * sandbox), or it is a check on the chat's own work (the sentinel, the ***plain rules, the ledger).
   */
  personOnly?: boolean;
}

/** What each effect is, said to the person. */
export const EFFECT_TEXT: Record<Effect, string> = {
  now: "in effect now",
  "next-message": "in effect from your next message",
  "next-pulse": "in effect from the next pulse - one running now keeps what it started with",
  "next-plan": "in effect the next time the work is planned - at the next pulse",
  "next-test-run": "in effect from the next test run - the running pulse's too",
  "next-landing": "in effect from the next pulse that lands - the running one too",
  "next-regenerate": "in effect for the next regeneration that names no .plain file",
  "next-start": "in effect the next time turri starts here",
};

const SECONDS = ["0", "60", "120", "180", "300"];

/** A role's line: which agents it is, for the list. */
const ROLE_ABOUT: Record<ModelRole, string> = {
  default: "every role not named",
  chat: "the conversation - as harness-model, which it wins over",
  sentinel: "the sentinel: checks every finished pulse and tests what is launched",
  planner: "cuts the work into pulses",
  capture: "captures an existing codebase into ***plain",
  "capture-exploration": "gathers facts and extracts the interface from the original code",
  "capture-analysis": "checks evidence, outlines features and tries scenarios on the original",
  diagnosis: "looks into a pulse that failed for good",
  launch: "the launch agent",
  coding: "writes the code - as coding-model, which it wins over",
  conformance: "writes the conformance tests",
  explorer: "explores the code for a conformance run",
  reviewer: "reviews the code and its unit tests",
  "test-reviewer": "reviews the conformance tests",
  judge: "judges a failing conformance run - as judge-model, which it wins over",
  arbiter: "weighs a second review",
  debugger: "a fresh look at unit tests that keep failing the same way",
};

/** Every setting, in the order the list shows them. */
export function settings(rules: string[] = []): Setting[] {
  const roles = (["default", ...AGENT_ROLES] as const).flatMap((role): Setting[] => [
    {
      key: `models.${role}`,
      about: `the ${role} role's model and thinking - ${ROLE_ABOUT[role]}`,
      kind: "model",
      unset: role === "default" ? "harness-model's, for the conversation's side; coding-model's for the rest" : role === "capture-exploration" ? "Haiku low on Claude; otherwise coding-model, low" : role === "capture-analysis" ? "Sonnet low on Claude; otherwise coding-model, low" : role === "capture" ? "Opus medium on Claude; otherwise harness-model, medium" : "default's",
      effect: role === "chat" ? "now" : "next-pulse",
      ...(role === "chat" ? { projectOnly: true } : {}),
    },
    {
      key: `models.${role}.turn-limit`,
      about: `seconds each turn of the ${role} role's agents has - 0 for none`,
      kind: "number",
      unset: role.startsWith("capture-") ? "capture's, else default's, else turn-limit" : "default's, else turn-limit",
      effect: "next-pulse",
      options: SECONDS,
      min: 0,
    },
  ]);
  const fixed = Object.entries(fixedSettings(rules)).map(([key, entry]) => ({ key, ...entry }) as Setting);
  return [...fixed, ...roles];
}

/** The settings that are not a role's, by key - each one there, with the kind its value takes. */
function fixedSettings(rules: string[]): { [K in Exclude<SettingKey, `models.${string}`>]: Entry<K> } {
  return {
    "harness-model": { about: "the model you talk to: it writes the ***plain and plans the work", kind: "model", unset: "pi's own choice", effect: "now", projectOnly: true },
    "coding-model": { about: "the model that writes the code", kind: "model", unset: "harness-model", effect: "next-pulse" },
    "judge-model": { about: "the judge and the test review of a conformance run", kind: "model", unset: "coding-model", effect: "next-pulse" },
    module: { about: "the .plain file turri regenerate builds when none is named", kind: "path", unset: "the folder's .plain files", effect: "next-regenerate", projectOnly: true },
    review: { about: "whether the code and its tests are reviewed once they pass", kind: "boolean", unset: "true", effect: "next-pulse" },
    "mutation-testing": { about: "whether the coding agent and the reviewer can put a bug in the code for one test run (can_it_fail)", kind: "boolean", unset: "true", effect: "next-pulse" },
    "allow-to-stop-jobs": { about: "whether turri stops a running pulse the ***plain has moved on from", kind: "boolean", unset: "true", effect: "now" },
    "launch-after-pulse": { about: "whether every pulse that lands code is launched, in the background", kind: "boolean", unset: "false", effect: "next-landing" },
    sentinel: { about: "whether a chat of its own checks every finished pulse, tests what is launched, and tells you what is wrong - ask: you are asked before it first opens", kind: "choice", options: ["ask", "true", "false"], unset: "ask", effect: "next-landing", personOnly: true },
    "conformance-tests": { about: "whether functional specs' scenarios are written and conformance tested - false: none, and the chat's conform refused", kind: "boolean", unset: "false", effect: "now", personOnly: true },
    "test-dir": { about: "the folder of the test plain files, a folder per module in it, by path from the project root", kind: "path", unset: "tests", effect: "now" },
    "base-folder": { about: "a folder a codebase that requires no other module starts from, by path from the project root - code to build on, files to use, copied in once", kind: "path", unset: "none: it starts empty", effect: "next-pulse" },
    "unittests-script": { about: "the unit testing script, by path from the project root", kind: "path", unset: "the one run_unittests*.sh found", effect: "next-test-run" },
    "conformance-tests-script": { about: "the conformance testing script, by path from the project root", kind: "path", unset: "the one run_conformance_tests*.sh found", effect: "next-test-run" },
    "prepare-environment-script": { about: "run on the build before every conformance testing script run, by path from the project root - optional", kind: "path", unset: "the one prepare_environment*.sh found, else none", effect: "next-test-run" },
    "testing-scripts-run-on": { about: "what the testing scripts run on: the code itself, or a fresh copy", kind: "choice", options: ["in-place", "copy"], unset: "in-place", effect: "next-test-run" },
    "parallel-jobs": { about: "how many pulses run at once, on modules that share nothing", kind: "number", options: ["1", "2", "3", "4", "6"], min: 1, unset: "half this machine's cores, one to four", effect: "now", projectOnly: true },
    "max-specs-per-pulse": { about: "the most functional specs the planner groups into one pulse", kind: "number", options: ["1", "2", "3", "4", "5", "6"], min: 1, unset: "3", effect: "next-plan" },
    "max-lines-per-pulse": { about: "the most lines of ***plain in one pulse before a group is split", kind: "number", options: ["60", "120", "200", "300"], min: 1, unset: "120", effect: "next-plan" },
    "turn-limit": { about: "seconds each agent turn has, for every role without its own - 0 for none", kind: "number", options: SECONDS, min: 0, unset: "120", effect: "next-pulse" },
    "compact-at": { about: "tokens of work an agent holds before it is compacted between turns", kind: "number", options: ["50000", "100000", "150000", "200000"], min: 1000, unset: "100000", effect: "next-pulse", projectOnly: true },
    "rules-off": { about: "***plain rules left out of the prompts of the agents that write ***plain", kind: "list", options: rules, unset: "none", effect: "next-message", projectOnly: true, personOnly: true },
    "agent-env.files": { about: "dotenv files whose variables the agents' commands get", kind: "list", unset: "none", effect: "next-pulse", projectOnly: true, personOnly: true },
    "agent-env.vars": { about: "variables from turri's environment the agents' commands get, by name", kind: "list", unset: "none", effect: "next-pulse", projectOnly: true, personOnly: true },
    toolchains: { about: "folders of this machine an agent's commands may read beside the usual ones", kind: "list", unset: "none", effect: "next-pulse", projectOnly: true, personOnly: true },
    debug: { about: "whether turri keeps what it writes for debugging it - agents' logs and sessions, pulse logs, outputs", kind: "boolean", unset: "false", effect: "next-pulse", projectOnly: true },
    "cache-keep": { about: "megabytes of package caches the project keeps; 0 keeps none", kind: "number", options: ["0", "1024", "4096", "16384"], min: 0, unset: "4096", effect: "next-start", projectOnly: true },
    "ledger-keep": { about: "megabytes of the ledger - what turri did, as facts - the project keeps; 0 keeps none", kind: "number", options: ["0", "50", "100", "500"], min: 0, unset: "100", effect: "next-start", projectOnly: true, personOnly: true },
  };
}

/** Every setting, as a host is given them: rules-off offering turri's own rules, as /settings offers them. */
export function configSettings(): Setting[] {
  return settings(loadRules(join(PACKAGE_ROOT, "genome", "rules")).map((rule) => rule.name));
}

/** A setting by its key - `review`, `models.coding` - or nothing. */
export function settingOf(key: string, rules: string[] = []): Setting | undefined {
  return settings(rules).find((setting) => setting.key === key.trim().toLowerCase().replace(/_/g, "-"));
}

/** A value read from what was typed: what to write, or that it is to be unset, or why it cannot be. */
export type Parsed = { value: unknown } | { unset: true } | { error: string };

/** The words that unset a setting. */
const UNSET = new Set(["unset", "default", "none", "-"]);

/**
 * What was typed for a setting, read as the file takes it: `true`/`false`, one of its words, a number at least its least,
 * a model `provider/id` with an optional `:thinking`, a list by commas. `known`: whether a model can be reached here -
 * when it is given, one that cannot is refused.
 */
export function parseValue(setting: Setting, typed: string, known?: (model: string) => boolean): Parsed {
  const text = typed.trim();
  if (UNSET.has(text.toLowerCase())) return { unset: true };
  if (text === "") return { error: `${setting.key} needs a value - or unset, for ${setting.unset}.` };
  switch (setting.kind) {
    case "boolean": {
      const word = text.toLowerCase();
      if (["true", "yes", "on"].includes(word)) return { value: true };
      if (["false", "no", "off"].includes(word)) return { value: false };
      return { error: `${setting.key} is true or false.` };
    }
    case "choice": {
      const word = text.toLowerCase();
      if (setting.options?.includes(word)) return { value: word === "false" ? false : word === "true" ? true : word };
      return { error: `${setting.key} is one of ${setting.options?.join(", ")}.` };
    }
    case "number": {
      const number = Number(text);
      if (!Number.isInteger(number) || number < (setting.min ?? 0)) return { error: `${setting.key} is a whole number of at least ${setting.min ?? 0}.` };
      return { value: number };
    }
    case "model": {
      const { model, thinking } = splitModelSpec(text);
      const colon = text.lastIndexOf(":");
      // A provider's own id may contain a colon (Bedrock's :0 version, or a catalogued model tag).
      const suffix = text.slice(colon + 1);
      if (colon !== -1 && thinking === undefined && !suffix.includes("/") && !/^\d+$/.test(suffix) && !known?.(text)) {
        return { error: `How hard it thinks is one of ${THINKING_LEVELS.join(", ")}: ${text.slice(colon + 1)} is not.` };
      }
      if (model === undefined) return { error: `${setting.key} is a model, provider/id - with :thinking if you like, such as :low.` };
      if (!model.includes("/")) return { error: `A model is written provider/id, such as anthropic/claude-opus-5-5: ${model} is not.` };
      if (known !== undefined && !known(model)) return { error: `${model} is not a model turri can reach here - sign in to its provider, or choose another.` };
      return { value: text };
    }
    case "list": {
      const items = text.split(",").map((item) => item.trim()).filter((item) => item !== "");
      if (setting.options !== undefined && setting.options.length > 0) {
        const unknown = items.filter((item) => !setting.options!.includes(item));
        if (unknown.length > 0) return { error: `Not one of ${setting.key}'s: ${unknown.join(", ")}. It takes ${setting.options.join(", ")}.` };
      }
      return { value: items };
    }
    case "path":
      return { value: text };
  }
}

/** The file's top-level mapping, or nothing of it. */
function loadMapping(text: string): Record<string, unknown> {
  try {
    const parsed = loadYaml(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A value as one YAML line's: `true`, `30%`, `[a, b]`, `anthropic/claude-opus-5-5:low`. */
function inline(value: unknown): string {
  return dumpYaml(value, { flowLevel: 0, lineWidth: -1 }).trim();
}

/** Where a top-level key is in the lines: its line and the end of what is indented under it. */
function blockOf(lines: string[], key: string): { at: number; end: number } | undefined {
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at === -1) return undefined;
  let end = at + 1;
  // Commented examples and blank lines can separate active roles in models:. Stop at the next key,
  // leaving trailing comments alone, or writing the mapping back would duplicate the roles below them.
  for (let i = end; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(?:#|$)/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    end = i + 1;
  }
  return { at, end };
}

/**
 * The file with a top-level key set to these lines, or taken out (`undefined`): in its place, its trailing comment kept
 * on a one-line value; a key not there goes under its commented-out example, else at the end.
 */
function withTopLevel(text: string, key: string, block: string[] | undefined): string {
  const lines = text.split("\n");
  const found = blockOf(lines, key);
  if (found !== undefined) {
    const comment = found.end - found.at === 1 && block?.length === 1 ? /\s+#.*$/.exec(lines[found.at]!.replace(/"[^"]*"|'[^']*'/g, ""))?.[0] : undefined;
    const replaced = block === undefined ? [] : comment !== undefined ? [`${block[0]}${comment}`] : block;
    return [...lines.slice(0, found.at), ...replaced, ...lines.slice(found.end)].join("\n");
  }
  if (block === undefined) return text;
  const example = lines.findIndex((line) => new RegExp(`^#\\s?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line));
  if (example !== -1) {
    let end = example + 1;
    while (end < lines.length && /^#\s{2,}\S/.test(lines[end]!)) end += 1;
    return [...lines.slice(0, end), ...block, ...lines.slice(end)].join("\n");
  }
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${block.join("\n")}\n`;
}

/** A role's entry under `models:` - a model string, or `model`, `thinking` and `turn-limit` - as one object. */
function roleEntry(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const { model, thinking } = splitModelSpec(value);
    return { ...(model !== undefined ? { model } : {}), ...(thinking !== undefined ? { thinking } : {}) };
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** A role's entry as written: the model string alone when it has no turn limit, else the object - nothing when empty. */
function writtenEntry(entry: Record<string, unknown>): unknown {
  const turnLimit = entry["turn-limit"] ?? entry.turn_limit;
  const model = typeof entry.model === "string" ? entry.model : undefined;
  const thinking = typeof entry.thinking === "string" ? entry.thinking : undefined;
  if (turnLimit === undefined) {
    if (model === undefined && thinking === undefined) return undefined;
    return `${model ?? ""}${thinking !== undefined ? `:${thinking}` : ""}`;
  }
  return { ...(model !== undefined ? { model } : {}), ...(thinking !== undefined ? { thinking } : {}), "turn-limit": turnLimit };
}

/** The file with a top-level key set to a value as it is - a block, such as `models:`, written whole - in its line, or under its commented-out example. */
export function withTopLevelValue(text: string, key: string, value: unknown): string {
  const block = value !== null && typeof value === "object" && !Array.isArray(value);
  return withTopLevel(text, key, block ? dumpYaml({ [key]: value }, { flowLevel: 2, lineWidth: -1 }).trimEnd().split("\n") : [`${key}: ${inline(value)}`]);
}

/**
 * The file with a setting set to a value, or unset (`undefined`). A top-level one is changed in its line; one under
 * `models:` or `agent-env:` has that block written again whole.
 */
export function withSetting(text: string, key: string, value: unknown): string {
  const [top, ...path] = key.split(".");
  if (path.length === 0) return withTopLevel(text, top!, value === undefined ? undefined : [`${top}: ${inline(value)}`]);
  const current = loadMapping(text)[top!];
  const block: Record<string, unknown> = current !== null && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  if (top === "models") {
    const [role, field] = path as [string, string | undefined];
    const entry = roleEntry(block[role]);
    if (field === "turn-limit") {
      delete entry.turn_limit;
      if (value === undefined) delete entry["turn-limit"];
      else entry["turn-limit"] = value;
    } else {
      delete entry.model;
      delete entry.thinking;
      if (value !== undefined) Object.assign(entry, roleEntry(value));
    }
    const written = writtenEntry(entry);
    if (written === undefined) delete block[role];
    else block[role] = written;
  } else {
    const field = path[0]!;
    if (value === undefined) delete block[field];
    else block[field] = value;
  }
  if (Object.keys(block).length === 0) return withTopLevel(text, top!, undefined);
  const lines = dumpYaml({ [top!]: block }, { flowLevel: 2, lineWidth: -1 }).trimEnd().split("\n");
  return withTopLevel(text, top!, lines);
}

/** A setting's value as the file has it - the raw value, before turri reads it - or undefined when it is not set. */
export function currentValue(text: string, key: string): unknown {
  const [top, ...path] = key.split(".");
  const value = loadMapping(text)[top!];
  if (path.length === 0) return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const block = value as Record<string, unknown>;
  if (top === "models") {
    const raw = block[path[0]!];
    if (raw === undefined) return undefined;
    const entry = roleEntry(raw);
    if (path[1] === "turn-limit") return entry["turn-limit"] ?? entry.turn_limit;
    return writtenEntry({ model: entry.model, thinking: entry.thinking });
  }
  return block[path[0]!];
}

/** A value for showing: `true`, `anthropic/claude-opus-5-5:low`, `[.env, .env.local]`. */
export function shownValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entry = value as Record<string, unknown>;
    return `${entry.model ?? ""}${entry.thinking !== undefined ? `:${entry.thinking}` : ""}`;
  }
  return inline(value);
}

/** What a setting takes, in words: `true or false`, `a model, provider/model-id[:thinking]`, `one of in-place, copy`. */
export function settingTakes(setting: Setting): string {
  switch (setting.kind) {
    case "boolean":
      return "true or false";
    case "model":
      return "a model, provider/model-id[:thinking]";
    case "path":
      return "a path from the project root";
    case "list":
      return `a list${setting.options !== undefined && setting.options.length > 0 ? ` of ${setting.options.join(", ")}` : ""}`;
    case "number":
      return setting.options !== undefined ? `a number - e.g. ${setting.options.join(", ")}` : "a number";
    case "choice":
      return `one of ${(setting.options ?? []).join(", ")}`;
  }
}

/**
 * A setting's value in config.turri.yaml - or `module`'s own config.turri.<module>.yaml - as its kind takes it; undefined
 * when it is unset there. A model is read as provider/model-id[:thinking], its turn limit apart. A value its kind
 * cannot take throws `config-invalid`, naming the file and what it takes; a key there is no setting of, `not-found`.
 */
export function readSetting<K extends SettingKey>(projectDir: string, key: K, options: { module?: string } = {}): SettingValues[K] | undefined {
  const setting = settingOf(key);
  if (setting === undefined) throw new TurriError("not-found", `There is no setting ${String(key)}.`);
  const { module } = options;
  const raw = currentValue(module !== undefined ? readModuleConfigText(projectDir, module) : readConfigText(projectDir), setting.key);
  if (raw === undefined || raw === null) return undefined;
  const read = valueOfKind(setting, raw);
  if (read === WRONG) throw new TurriError("config-invalid", `${module !== undefined ? moduleConfigFile(module) : CONFIG_FILE}'s ${setting.key} is ${inline(raw)}: it takes ${settingTakes(setting)}.`);
  return read as SettingValues[K] | undefined;
}

const WRONG = Symbol("wrong");

/** A value as a file has it, read as its setting's kind takes it - undefined, a model with no model or thinking; WRONG, one it cannot take. */
function valueOfKind(setting: Setting, raw: unknown): unknown {
  switch (setting.kind) {
    case "boolean":
      return typeof raw === "boolean" ? raw : WRONG;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : WRONG;
    case "list":
      return Array.isArray(raw) && raw.every((item) => typeof item === "string") ? [...raw] : typeof raw === "string" ? [raw] : WRONG;
    case "path":
      return typeof raw === "string" ? raw : WRONG;
    case "choice":
      return (typeof raw === "string" || typeof raw === "boolean") && (setting.options ?? []).includes(String(raw)) ? raw : WRONG;
    case "model": {
      if (typeof raw !== "string" && (typeof raw !== "object" || Array.isArray(raw))) return WRONG;
      const shown = shownValue(raw);
      return shown === "" ? undefined : shown;
    }
  }
}

/** The project's config.turri.yaml - or the config.yaml it is read from until it has one - its text, empty when there is neither. */
export function readConfigText(dir: string): string {
  const path = join(dir, projectConfigFile(dir));
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * What a change does beside setting the value: the files and settings that win over it, said to the person. `module`:
 * written into that module's own file - the project's file is the one it wins over, and nothing over it is said.
 */
export function overriddenBy(dir: string, text: string, setting: Setting, module?: string): string[] {
  const notes: string[] = [];
  const wins: Record<string, string> = { "harness-model": "models.chat", "coding-model": "models.coding", "judge-model": "models.judge" };
  const over = wins[setting.key];
  if (over !== undefined && currentValue(text, over) !== undefined) notes.push(`${over} is set too, and wins over ${setting.key} - change it with /settings ${over}.`);
  if (setting.projectOnly === true || module !== undefined) return notes;
  const top = setting.key.split(".")[0]!;
  for (const each of moduleConfigsOf(dir)) {
    const file = moduleConfigFileIn(dir, each);
    const own = loadMapping(safeRead(join(dir, file)))[top];
    if (own !== undefined) notes.push(`${file} sets ${top} too, and wins for ${each}.plain and the modules built on it.`);
  }
  return notes;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Write a setting into the project's config.turri.yaml - or, with `module`, that module's config.turri.<module>.yaml -
 * made when it is not there, from config.yaml and each module's file in the old naming when they are what the project
 * is read from - and give back the file as written.
 */
export function writeSetting(dir: string, key: string, value: unknown, module?: string): string {
  adoptLegacyConfig(dir);
  const text = withSetting(module !== undefined ? safeRead(join(dir, moduleConfigFile(module))) : readConfigText(dir), key, value);
  writeFileSync(join(dir, module !== undefined ? moduleConfigFile(module) : CONFIG_FILE), text);
  return text;
}

/** A module's own config.turri.<module>.yaml - or the config.<module>.yaml it is read from until the project has turri's files - its text, empty when there is none. */
export function readModuleConfigText(dir: string, module: string): string {
  return safeRead(join(dir, moduleConfigFileIn(dir, module)));
}

/** The files a path setting is offered: the testing scripts in the root and test_scripts/, the .plain files of the folder, or - the test folder - its folders. */
export function pathOptions(dir: string, key: string): string[] {
  const list = (folder: string, test: (name: string) => boolean) => {
    try {
      return readdirSync(join(dir, folder))
        .filter((name) => test(name) && statSync(join(dir, folder, name)).isFile())
        .map((name) => (folder === "" ? name : `${folder}/${name}`));
    } catch {
      return [];
    }
  };
  if (key === "module") return list("", (name) => name.endsWith(".plain")).sort();
  if (key === "test-dir" || key === "base-folder") {
    const own = key === "test-dir" ? ["tests"] : [];
    try {
      const folders = readdirSync(dir).filter((name) => !name.startsWith(".") && name !== "plain_modules" && name !== "node_modules" && statSync(join(dir, name)).isDirectory());
      return [...new Set([...own, ...folders])].sort();
    } catch {
      return own;
    }
  }
  const prefix =
    key === "unittests-script" ? "run_unittests" : key === "conformance-tests-script" ? "run_conformance_tests" : "prepare_environment";
  const script = (name: string) => name.startsWith(prefix) && /\.(sh|ps1)$/.test(name);
  return [...list("", script), ...list("test_scripts", script)].sort();
}

/** The dotenv files of the project root, for agent-env.files. */
export function dotenvFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => /^\.env(\..+)?$/.test(name)).sort();
  } catch {
    return [];
  }
}

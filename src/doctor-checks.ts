/**
 * What doctor is asked - the project, whether to ask its models, models of the caller's own - and what its checks come
 * to, told. Apart from the checks (setup.ts), so the machine's entry loads no pi until doctor runs.
 */
import { configOverrides, hasProjectConfig, splitModelSpec, type ProjectConfig } from "./config.ts";
import type { Check, Level } from "./node-check.ts";

export const MARK: Record<Level, string> = { ok: "✓", missing: "✗", limited: "!", info: "·" };

/** Models doctor checks in place of the config's - named on a command line - as provider/model-id[:thinking]. */
export interface DoctorModels {
  harnessModel?: string;
  codingModel?: string;
  judgeModel?: string;
}

export interface DoctorOptions {
  /** The project to check. Without it, only the machine. */
  dir?: string;
  /** Ask each model the project's config names for a word - a request a model, which costs money. Off by default. */
  models?: boolean;
  /**
   * Models of the caller's own, checked in place of the config's - as a session's overrides are read, a role's own
   * `models:` entry still winning - and asked, with `models`. Their AWS region is worked out with the config's.
   */
  overrides?: DoctorModels;
  /** The environment whose PATH is looked in - bash, git, the sandbox, the toolchains, what the testing scripts run. */
  env?: NodeJS.ProcessEnv;
}

/** Whether doctor asks the models: asked to, and a config that names them - or a session's own models in the project. */
export function asksModels(options: DoctorOptions): options is DoctorOptions & { dir: string } {
  if (options.models !== true || options.dir === undefined) return false;
  const given = { ...configOverrides(options.dir), ...modelChoices(options.overrides ?? {}) };
  return hasProjectConfig(options.dir) || given.harnessModel !== undefined || given.codingModel !== undefined || given.judgeModel !== undefined;
}

/** The models given, as the config's keys hold them. */
export function modelChoices(given: DoctorModels): Partial<Pick<ProjectConfig, "harnessModel" | "codingModel" | "judgeModel">> {
  const choice = (spec: string | undefined) => (spec !== undefined && spec.trim() !== "" ? splitModelSpec(spec.trim()) : undefined);
  const [harnessModel, codingModel, judgeModel] = [choice(given.harnessModel), choice(given.codingModel), choice(given.judgeModel)];
  return { ...(harnessModel !== undefined ? { harnessModel } : {}), ...(codingModel !== undefined ? { codingModel } : {}), ...(judgeModel !== undefined ? { judgeModel } : {}) };
}

/** The models given, as specs. */
export function specsOf(given: DoctorModels): string[] {
  return Object.values(modelChoices(given)).flatMap((choice) => (choice?.model !== undefined ? [choice.model] : []));
}

/** What the checks add up to: whether turri can run here, and a line saying so - with its marks, uncoloured. */
export function verdictOf(checks: Check[]): { ready: boolean; limited: boolean; text: string } {
  const missing = checks.filter((check) => check.level === "missing").length;
  if (missing > 0) return { ready: false, limited: false, text: `Not ready: ${missing} thing${missing === 1 ? "" : "s"} to fix (✗ above).` };
  return checks.some((check) => check.level === "limited") ? { ready: true, limited: true, text: "Ready, with limits (! above)." } : { ready: true, limited: false, text: "Ready." };
}

/** The checks as plain text, a line each and what to do under it, and the verdict - for a reader that is not a terminal. */
export function describeChecks(checks: Check[]): string {
  const lines = checks.flatMap((check) => [
    `${MARK[check.level]} ${check.name}: ${check.detail}`,
    ...(check.more ?? []).map((line) => `    ${line}`),
    ...(check.fix && check.level !== "ok" ? [`    → ${check.fix}`] : []),
  ]);
  return `${lines.join("\n")}\n\n${verdictOf(checks).text}`;
}

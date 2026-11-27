import { spawnSync } from "node:child_process";
import { spawnAsync } from "./spawn-async.ts";
import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { EXTENSION_PROVIDERS, installedProviders, runtimeWithProviders } from "./installed-providers.ts";
import { checkNode, type Check, type Level } from "./node-check.ts";
import { sandboxAvailable, sandboxWithAsync, type Wall } from "./regenerate/os-sandbox.ts";
import { findTestScripts, onThisMachine } from "./regenerate/test-scripts.ts";
import { CONFIG_FILE, hasProjectConfig, readProjectConfig, moduleConfigFile, configModuleOf, moduleConfigsOf, configProblems } from "./config.ts";
import { checkModels, modelsInUse, piModelAccess, type ModelAccess } from "./model-check.ts";
import { asksModels, modelChoices, specsOf, type DoctorModels, type DoctorOptions } from "./doctor-checks.ts";
import { applyBedrockRegion, bedrockRegionFor, describeBedrockRegion, regionInGeography, type BedrockRegion } from "./bedrock-region.ts";
import { baseFilesAsync } from "./regenerate/base-folder.ts";
import { readScript, scriptAgainstMachine, stackOnMachineAsync } from "./stack.ts";

/**
 * `turri doctor`: whether this machine is ready for turri.
 *
 * It looks: Node, a bash to run commands with, which wall is up under the agents' commands - Seatbelt, bubblewrap, or
 * the command check and the audit alone - and, in a project, whether this machine has the toolchains its modules'
 * implementation reqs name and what its testing scripts run, and whether each model its config names answers with this
 * machine's credentials - one short request a model (model-check.ts). It changes one thing, asked first: a plain `pi`
 * that an older turri made load turri too is put back to plain pi.
 *
 * `doctor()` is the checks alone, for the CLI and for a host (src/host.ts): it prints nothing and asks nothing.
 */

export { checkNode, type Check, type Level };
export { asksModels, describeChecks, MARK, verdictOf, type DoctorModels, type DoctorOptions } from "./doctor-checks.ts";


/** bash: every agent command and every testing script runs with it, on every platform. */
export function checkShell(found: boolean = spawnSync("bash", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0, platform: NodeJS.Platform = process.platform): Check {
  if (found) return { level: "ok", name: "bash", detail: "on the PATH - agents' commands and the testing scripts run with it" };
  return {
    level: "missing",
    name: "bash",
    detail: "not on the PATH - agents' commands and the testing scripts run with it",
    fix: platform === "win32" ? "install Git for Windows (Git Bash), and put its bash on the PATH" : "install bash with your system's package manager",
  };
}

/** git: each module's history, which every pulse starts from and lands in, and the spec diffs the work is planned from. */
export function checkGit(found: boolean = spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0): Check {
  if (found) return { level: "ok", name: "git", detail: "on the PATH - each module's history, and the spec diffs" };
  return {
    level: "missing",
    name: "git",
    detail: "not on the PATH - each module's history is a git repository, and the work is planned from git diffs",
    fix: "install git with your system's package manager",
  };
}

/** Which wall is up under the agents' commands, and - where none starts - why, and how to give it one. */
export function checkSandbox(wall: Wall = sandboxAvailable(), platform: NodeJS.Platform = process.platform): Check {
  if (wall.kind === "seatbelt") return { level: "ok", name: "OS sandbox", detail: "Seatbelt - under the command check and the audit" };
  if (wall.kind === "bubblewrap") {
    return { level: "ok", name: "OS sandbox", detail: `bubblewrap${wall.proc === "bind" ? ", the host's /proc bound (this container masks its own)" : ""} - under the command check and the audit` };
  }
  return {
    level: platform === "win32" ? "info" : "limited",
    name: "OS sandbox",
    detail: `none - ${wall.why}; the command check and the audit hold alone`,
    ...(wall.fix !== undefined ? { fix: wall.fix } : {}),
  };
}

/**
 * In a project: each module's toolchains, as its implementation reqs name them, against this machine's PATH; and each
 * testing script against this machine - a program it names that is not here, a toolchain it runs that is not on the
 * PATH. Nothing outside a project.
 */
export async function checkProject(
  project: string,
  machine: { has?: (command: string) => boolean; exists?: (path: string) => boolean; jdk?: () => boolean | Promise<boolean> } = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  for (const { module, needs, missing } of await stackOnMachineAsync(project, machine.has, machine.jdk)) {
    if (needs.length === 0) continue;
    checks.push(
      missing.length === 0
        ? { level: "ok", name: `${module}`, detail: `has ${needs.map((need) => need.toolchain).join(", ")}` }
        : {
            level: "missing",
            name: `${module}`,
            detail: `its implementation reqs need ${missing.map((need) => `${need.toolchain} (${need.words.join(", ")})`).join(", ")}, which this machine lacks`,
            fix: `install ${missing.map((need) => need.toolchain).join(" and ")} on this machine - the agents use its toolchains, and install none`,
          },
    );
  }
  const scripts = findTestScripts(project);
  for (const script of [scripts.unit, scripts.prepare, scripts.conformance]) {
    if (script === undefined) continue;
    const text = readScript(script);
    if (text === undefined) continue;
    const found = scriptAgainstMachine(text, machine);
    if (found.length === 0) continue;
    checks.push({
      level: "limited",
      name: relative(project, script),
      detail: "does not fit this machine - it is yours to fix:",
      more: found,
    });
  }
  return checks;
}

async function checkProvider(project: string = process.cwd()): Promise<Check> {
  try {
    // pi's providers, and those the person's installed pi extensions register - a Claude subscription through Claude Code.
    const runtime = await runtimeWithProviders(await installedProviders(project));
    const available = new ModelRegistry(runtime).getAvailable();
    const providers = [...new Set(available.map((model) => model.provider))];
    if (providers.length > 0) {
      return { level: "ok", name: "Model provider", detail: `${providers.join(", ")} (${available.length} models)` };
    }
  } catch {
    // Reported as missing below.
  }
  return {
    level: "missing",
    name: "Model provider",
    detail: "no model has credentials",
    fix: "run `pi` and use /login, or set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ...)",
  };
}

/**
 * In a project: each model its config.turri.yaml names - or the module config pinned, its file's over it - tried with one short
 * request. A model that answers is ready; one that does not says what the provider said, and what to do about it.
 */
export async function checkProjectModels(project: string, access?: ModelAccess, given: DoctorModels = {}): Promise<Check[]> {
  const used = modelsInUse({ ...readProjectConfig(project, configModuleOf(project)), ...modelChoices(given) });
  if (used.length === 0) {
    return [{ level: "missing", name: "Models", detail: "config.turri.yaml names none", fix: "turri init-config writes the two models - or name them here: --harness-model, --coding-model" }];
  }
  let verdicts;
  try {
    // The AWS region the Bedrock models need, set as a session sets it as it opens: doctor asks them with none open.
    const region = describeBedrockRegion(applyBedrockRegion(project, { also: specsOf(given) }));
    verdicts = await checkModels(used, access ?? (await piModelAccess()), region !== undefined ? { bedrockRegion: region } : {});
  } catch (error) {
    return [{ level: "missing", name: "Models", detail: `pi's models could not be read: ${error instanceof Error ? error.message : String(error)}` }];
  }
  return verdicts.map((verdict) => {
    const name = verdict.usedBy.join(", ");
    return verdict.ok
      ? { level: "ok" as const, name, detail: `${verdict.spec} answered (${(verdict.ms / 1000).toFixed(1)}s)` }
      : { level: "missing" as const, name, detail: verdict.spec, more: [verdict.problem], fix: verdict.fix };
  });
}

/** Whether `command` runs with `env` - its PATH looked in, as the agents' shells and the testing scripts would. Never holds a host's thread up. */
async function runs(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return (await spawnAsync(command, ["--version"], { env })).status === 0;
}

/**
 * Whether this machine - and, with `dir`, that project - is ready for turri, as checks. It prints nothing and asks
 * nothing, so a host can show them in its own way; `turri doctor` prints the same.
 */
export async function doctor(options: DoctorOptions = {}): Promise<Check[]> {
  const env = options.env ?? process.env;
  // Each check that runs a command runs it without holding the thread up - a host asks on its own - side by side.
  const [bash, git, wall, provider] = await Promise.all([runs("bash", env), runs("git", env), sandboxWithAsync(env), checkProvider(options.dir)]);
  const checks: Check[] = [checkNode(), checkShell(bash), checkGit(git), checkSandbox(wall), provider];
  // In a project: what it needs of this machine, and whether its models answer.
  const project = options.dir;
  if (project === undefined) return checks;
  // A config that does not parse is read as empty - every setting at its default, the models pi's own: said first.
  checks.push(...configProblems(project).map((problem): Check => ({
    level: "missing",
    name: "Config",
    detail: problem.text,
    more: [`turri reads a config that does not parse as empty: none of ${problem.file} applies - not its models, not conformance tests, no other setting.`],
    fix: `Set each key once in ${problem.file}, then run turri doctor again`,
  })));
  if (hasProjectConfig(project) || existsSync(join(project, "plain_modules"))) checks.push(...(await checkProject(project, { has: (command) => onThisMachine(command, env) !== undefined })));
  const given = options.overrides ?? {};
  if (hasProjectConfig(project)) checks.push(...checkBedrockRegion(project, env, specsOf(given)), ...(await checkClaudeSubscription(project, env, undefined, specsOf(given))), ...(await checkBaseFolders(project)));
  if (asksModels(options)) checks.push(...(await checkProjectModels(project, undefined, given)));
  return checks;
}

/** The environment pi-claude-code refuses to run with: each points Claude Code at an API key or another backend, not the subscription. */
export const CLAUDE_CODE_CONFLICTS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY"];
const CLAUDE_CODE_BACKENDS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

/** What the Claude subscription check looks at - this machine's, or a test's. */
export interface ClaudeCodeProbe {
  /** Whether pi has the claude-code provider: its extension, pi-claude-code, installed. */
  installed(): Promise<boolean>;
  /** `claude auth status`, as it answers: undefined when there is no claude to run. */
  status(command: string, env: NodeJS.ProcessEnv): Promise<{ loggedIn?: boolean; subscriptionType?: string; authMethod?: string } | undefined>;
  /** The executable a command name is, on the PATH - undefined when it is not there. */
  which(command: string, env: NodeJS.ProcessEnv): string | undefined;
}

const claudeCodeProbe = (project: string): ClaudeCodeProbe => ({
  installed: async () => (await installedProviders(project))?.getRegisteredProviderIds().includes("claude-code") === true,
  async status(command, env) {
    const run = await spawnAsync(command, ["auth", "status"], { env, timeout: 15_000 });
    if (run.error !== undefined) return undefined;
    try {
      return JSON.parse(run.stdout) as { loggedIn?: boolean; subscriptionType?: string; authMethod?: string };
    } catch {
      return { loggedIn: false };
    }
  },
  which: (command, env) => (command.includes("/") ? (existsSync(command) ? command : undefined) : onThisMachine(command, env)),
});

/**
 * A Claude subscription through Claude Code, when the project's config names a `claude-code/...` model: everything
 * pi-claude-code needs, in the order it needs it - its extension installed, Claude Code on the PATH, signed in to a Pro or
 * Max subscription, and nothing in the environment it refuses. Nothing when no model is a claude-code one.
 */
export async function checkClaudeSubscription(project: string, env: NodeJS.ProcessEnv = process.env, probe: ClaudeCodeProbe = claudeCodeProbe(project), also: string[] = []): Promise<Check[]> {
  const configs = [readProjectConfig(project), ...moduleConfigsOf(project).map((module) => readProjectConfig(project, module))];
  const named = [...new Set([...configs.flatMap((config) => modelsInUse(config)).map((used) => used.spec), ...also].filter((spec) => spec.startsWith("claude-code/")))];
  if (named.length === 0) return [];
  const name = "Claude subscription";
  const extension = EXTENSION_PROVIDERS["claude-code"]!;
  if (!(await probe.installed())) {
    return [{ level: "missing", name, detail: `${named.join(", ")} need pi-claude-code, pi's extension for a Claude subscription, which is not installed`, fix: extension.install }];
  }
  const command = env.PI_CLAUDE_CODE_COMMAND?.trim() || "claude";
  const found = probe.which(command, env);
  if (found === undefined) {
    return [{ level: "missing", name, detail: `Claude Code (${command}) is not on the PATH - every claude-code request goes through it`, fix: "npm install -g @anthropic-ai/claude-code - or name it in PI_CLAUDE_CODE_COMMAND" }];
  }
  const configDir = env.PI_CLAUDE_CODE_CONFIG_DIR?.trim();
  const status = await probe.status(found, configDir ? { ...env, CLAUDE_CONFIG_DIR: configDir } : env);
  if (status?.loggedIn !== true) return [{ level: "missing", name, detail: `Claude Code (${found}) is not signed in`, fix: "claude auth login - with the Claude account that has the Pro or Max subscription" }];
  if (status.subscriptionType === undefined || status.subscriptionType === "") {
    return [{ level: "missing", name, detail: `Claude Code is signed in${status.authMethod !== undefined ? ` (${status.authMethod})` : ""}, but not to a Claude subscription`, fix: "claude auth logout, then claude auth login with the account that has the Pro or Max subscription" }];
  }
  const conflicts = [...CLAUDE_CODE_CONFLICTS.filter((key) => (env[key] ?? "") !== ""), ...CLAUDE_CODE_BACKENDS.filter((key) => /^(1|true|yes|on)$/i.test(env[key]?.trim() ?? ""))];
  if (conflicts.length > 0) {
    return [{ level: "missing", name, detail: `${conflicts.join(", ")} ${conflicts.length === 1 ? "is" : "are"} set: pi-claude-code refuses to run with ${conflicts.length === 1 ? "it" : "them"}, as ${conflicts.length === 1 ? "it points" : "they point"} Claude Code away from the subscription`, fix: `unset ${conflicts.join(" ")} where turri starts - your shell's profile, say` }];
  }
  return [{ level: "ok", name, detail: `pi-claude-code installed, Claude Code signed in to ${status.subscriptionType} - for ${named.join(", ")}` }];
}

/**
 * The base folders the project's config names - its own, and each module's own file's - each there with its files, or not: a codebase
 * that requires nothing starts from one, and its first pulse stops when it is not there. Nothing when none is named.
 */
export async function checkBaseFolders(project: string): Promise<Check[]> {
  const named = new Map<string, string[]>();
  for (const [module, config] of [[undefined, readProjectConfig(project)] as const, ...moduleConfigsOf(project).map((module) => [module, readProjectConfig(project, module)] as const)]) {
    if (config.baseFolder === undefined) continue;
    named.set(config.baseFolder, [...(named.get(config.baseFolder) ?? []), module === undefined ? CONFIG_FILE : moduleConfigFile(module)]);
  }
  return Promise.all([...named].map(async ([folder, files]): Promise<Check> => {
    const path = resolve(project, folder);
    const name = `base folder ${folder}`;
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return { level: "missing", name, detail: `${existsSync(path) ? "not a folder" : "not there"} - named in ${files.join(", ")}`, fix: "make the folder, or name the right one in base-folder:, by path from the project's folder" };
    }
    const count = (await baseFilesAsync(path)).length;
    return { level: "ok", name, detail: `${count} file${count === 1 ? "" : "s"} to start a codebase from - named in ${files.join(", ")}` };
  }));
}

/**
 * The AWS region a project's Bedrock models are called in, when it uses any: turri's, the person's or the profile's - and
 * what is wrong with it, when the models need two, or the person's is not in their geography. Nothing when it uses none.
 */
export function checkBedrockRegion(project: string, env: NodeJS.ProcessEnv = process.env, also: string[] = []): Check[] {
  let decided: BedrockRegion;
  try {
    decided = bedrockRegionFor(project, { env, also });
  } catch {
    return [];
  }
  const line = describeBedrockRegion(decided);
  if (decided.models.length === 0 || line === undefined) return [];
  const outside = decided.source === "set" && decided.needs !== undefined && decided.region !== undefined && !regionInGeography(decided.region, decided.needs.geography);
  if (decided.conflict !== undefined) return [{ level: "missing", name: "AWS region", detail: "the Bedrock models need two regions", more: [line] }];
  if (outside) return [{ level: "missing", name: "AWS region", detail: `${decided.region}, which does not serve ${decided.needs!.geography}'s models`, more: [line] }];
  return [{ level: "ok", name: "AWS region", detail: line }];
}


import { spawnSync } from "node:child_process";
import { spawnAsync, yieldToHost } from "./spawn-async.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { plainFileParser, withParseCache } from "./plain/parser.ts";
import { resolveTemplateDirs } from "./regenerate/paths.ts";
import { sectionsOf } from "./regenerate/state.ts";
import { onThisMachine } from "./regenerate/test-scripts.ts";

/**
 * What a project's specs need of this machine: the toolchains its implementation reqs name, and whether the machine
 * has them - the agents use this machine's toolchains and install none.
 *
 * The implementation reqs say what the code is written in and built with - "Python 3.12 and FastAPI", "a React app
 * built with Vite", "Java 21 with Spring Boot". This reads them, and says which toolchain each needs and by which word -
 * a hint for the person, not a verdict: a req can name a technology it does not use.
 */

/**
 * A toolchain the reqs name: its name, the commands any one of which shows it is there, the words that named it - and
 * the version they pin it to, the highest they name, when they name one (`Go 1.25`, `Java 21`).
 */
export interface StackNeed {
  toolchain: string;
  commands: string[];
  words: string[];
  version?: string;
}

/** A toolchain this machine has, older than the version its reqs pin: what it has. */
export type OlderNeed = StackNeed & { version: string; found: string };

/**
 * The toolchains whose version the reqs pin and this machine is asked for: how the reqs name it, and how its command
 * says its own. Not Python: its stacks run through uv, which finds or fetches the Python a project asks for itself.
 */
const PINNED: Record<string, { named: RegExp; command: string; args: string[]; read: RegExp }> = {
  Go: { named: /\bgo (\d+\.\d+(?:\.\d+)?)\b/gi, command: "go", args: ["version"], read: /\bgo(\d+\.\d+(?:\.\d+)?)/ },
  Java: { named: /\bjava (\d+)\b/gi, command: "java", args: ["-version"], read: /version "(\d+(?:\.\d+)*)/ },
  Node: { named: /\bnode(?:\.js)? (\d+(?:\.\d+)*)\b/gi, command: "node", args: ["--version"], read: /\bv(\d+(?:\.\d+)*)/ },
  Rust: { named: /\brust (\d+\.\d+(?:\.\d+)?)\b/gi, command: "cargo", args: ["--version"], read: /\bcargo (\d+\.\d+(?:\.\d+)?)/ },
};

/** Whether version `a` is older than `b`, segment by segment, as far as `b` says: 1.24.3 is older than 1.25, 1.25.1 is not. */
export function olderThan(a: string, b: string): boolean {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let at = 0; at < y.length; at += 1) {
    const [p, q] = [x[at] ?? 0, y[at]!];
    if (p !== q) return p < q;
  }
  return false;
}

/** What a toolchain's command says its version is - from its whole output - or nothing when it says none. */
export function versionIn(toolchain: string, output: string): string | undefined {
  return PINNED[toolchain]?.read.exec(output)?.[1];
}

/** Words in implementation reqs, and the toolchain each means. */
const STACKS: Array<{ toolchain: string; commands: string[]; words: RegExp }> = [
  { toolchain: "Python", commands: ["python3", "python"], words: /\b(python|fastapi|django|flask|pytest|pydantic|sqlalchemy|uvicorn)\b/gi },
  { toolchain: "Node", commands: ["node"], words: /\b(node(\.js)?|typescript|javascript|react|vite|next\.js|express|vue|svelte|npm|vitest|jest|playwright)\b/gi },
  { toolchain: "Java", commands: ["java"], words: /\b(java|spring( boot)?|maven|gradle|junit|kotlin)\b/gi },
  { toolchain: "Go", commands: ["go"], words: /\b(golang|go \d+\.\d+|go modules?|written in go)\b/gi },
  { toolchain: "Rust", commands: ["cargo"], words: /\b(rust|cargo|tokio|axum)\b/gi },
  { toolchain: "C/C++", commands: ["cc", "gcc", "clang"], words: /(\bc\+\+|\bcmake\b|\bgcc\b|\bclang\b|\bwritten in c\b)/gi },
  { toolchain: "Zig", commands: ["zig"], words: /\bzig\b/gi },
  { toolchain: "Odin", commands: ["odin"], words: /\bodin\b/gi },
  { toolchain: "Ruby", commands: ["ruby"], words: /\b(ruby|rails)\b/gi },
  { toolchain: "PHP", commands: ["php"], words: /\b(php|laravel|symfony)\b/gi },
  { toolchain: "Elixir", commands: ["elixir"], words: /\b(elixir|phoenix)\b/gi },
];

/** The toolchains a text of implementation reqs names. */
export function stackOf(text: string): StackNeed[] {
  const needs: StackNeed[] = [];
  for (const stack of STACKS) {
    const words = [...new Set([...text.matchAll(stack.words)].map((match) => match[0].toLowerCase()))];
    if (words.length === 0) continue;
    const pinned = PINNED[stack.toolchain];
    const versions = pinned === undefined ? [] : [...text.matchAll(pinned.named)].map((match) => match[1]!);
    const version = versions.reduce<string | undefined>((highest, each) => (highest === undefined || olderThan(highest, each) ? each : highest), undefined);
    needs.push({ toolchain: stack.toolchain, commands: stack.commands, words, ...(version !== undefined ? { version } : {}) });
  }
  return needs;
}

/** The implementation reqs of every module in a project's folder, as the parser has them - imports in. */
export function projectImplementationReqs(project: string): Array<{ module: string; reqs: string[] }> {
  let files: string[];
  try {
    files = readdirSync(project).filter((name) => name.endsWith(".plain"));
  } catch {
    return [];
  }
  // One parse a module for all of them: each parse goes down its requires chain, and a project of long chains would
  // parse the modules at the bottom once for every module above them.
  return withParseCache(() => {
    const modules: Array<{ module: string; reqs: string[] }> = [];
    for (const name of files) {
      const path = join(project, name);
      try {
        const [module, tree] = plainFileParser(basename(path), resolveTemplateDirs(path), { allowNoFunctionalities: true });
        modules.push({ module, reqs: sectionsOf(tree)["implementation reqs"] });
      } catch {
        // A file that does not parse, or an import module read on its own, names nothing here.
      }
    }
    return modules;
  });
}

/**
 * `projectImplementationReqs`, giving the host's thread back between modules: a host - doctor on its own thread - answers
 * meanwhile. Each module is parsed as `plainFileParser` keeps it, so the chain below one parsed already is not again.
 */
export async function projectImplementationReqsAsync(project: string): Promise<Array<{ module: string; reqs: string[] }>> {
  let files: string[];
  try {
    files = readdirSync(project).filter((name) => name.endsWith(".plain"));
  } catch {
    return [];
  }
  const modules: Array<{ module: string; reqs: string[] }> = [];
  for (const name of files) {
    await yieldToHost();
    const path = join(project, name);
    try {
      const [module, tree] = plainFileParser(basename(path), resolveTemplateDirs(path), { allowNoFunctionalities: true });
      modules.push({ module, reqs: sectionsOf(tree)["implementation reqs"] });
    } catch {
      // As projectImplementationReqs: nothing named here.
    }
  }
  return modules;
}

/** Whether a command is on this machine's PATH. */
const onPath = (command: string) => onThisMachine(command) !== undefined;

/** The version of a toolchain on this machine, as its command says it - nothing when it says none. */
function versionHere(toolchain: string): string | undefined {
  const pinned = PINNED[toolchain];
  if (pinned === undefined) return undefined;
  const run = spawnSync(pinned.command, pinned.args, { encoding: "utf8", timeout: 10_000, env: { ...process.env, JAVA_TOOL_OPTIONS: "" } });
  return run.error === undefined ? versionIn(toolchain, `${run.stdout ?? ""}\n${run.stderr ?? ""}`) : undefined;
}

/** `versionHere`, without holding the thread up. */
async function versionHereAsync(toolchain: string): Promise<string | undefined> {
  const pinned = PINNED[toolchain];
  if (pinned === undefined) return undefined;
  const run = await spawnAsync(pinned.command, pinned.args, { env: { ...process.env, JAVA_TOOL_OPTIONS: "" } });
  return versionIn(toolchain, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
}

/** What a project's modules need of this machine: each module's needs, those the machine lacks, and those it has older. */
export type MachineNeeds = Array<{ module: string; needs: StackNeed[]; missing: StackNeed[]; older: OlderNeed[] }>;

/**
 * What a project's modules need of this machine, which of it the machine lacks - `has` finding a command, and on macOS
 * a JDK behind `java` (`toolchainCheck`), asked at most once - and which it has older than their reqs pin: `version`
 * says the machine's, asked at most once a toolchain.
 */
export function stackOnMachine(
  project: string,
  has: (command: string) => boolean = onPath,
  jdk: () => boolean = jdkHere,
  version: (toolchain: string) => string | undefined = versionHere,
): MachineNeeds {
  let found: boolean | undefined;
  const modules = projectImplementationReqs(project);
  const versions = new Map<string, string | undefined>();
  const here = toolchainCheck(has, () => (found ??= jdk()));
  for (const need of modules.flatMap(({ reqs }) => stackOf(reqs.join("\n")))) {
    if (need.version !== undefined && !versions.has(need.toolchain) && need.commands.some(here)) versions.set(need.toolchain, version(need.toolchain));
  }
  return needsAgainst(modules, here, versions);
}

/** `stackOnMachine`, never holding the host's thread up: the modules parsed one a turn, a JDK and versions asked without blocking. */
export async function stackOnMachineAsync(
  project: string,
  has: (command: string) => boolean = onPath,
  jdk: () => boolean | Promise<boolean> = jdkHereAsync,
  version: (toolchain: string) => string | undefined | Promise<string | undefined> = versionHereAsync,
): Promise<MachineNeeds> {
  const modules = await projectImplementationReqsAsync(project);
  const needs = modules.flatMap(({ reqs }) => stackOf(reqs.join("\n")));
  // Asked only when a module needs Java and java is on the PATH - as stackOnMachine asks it, at most once.
  let found = false;
  if (needs.some((need) => need.commands.includes("java")) && has("java")) found = await jdk();
  const here = toolchainCheck(has, () => found);
  const versions = new Map<string, string | undefined>();
  for (const need of needs) {
    if (need.version !== undefined && !versions.has(need.toolchain) && need.commands.some(here)) versions.set(need.toolchain, await version(need.toolchain));
  }
  return needsAgainst(modules, here, versions);
}

function needsAgainst(modules: Array<{ module: string; reqs: string[] }>, here: (command: string) => boolean, versions: Map<string, string | undefined>): MachineNeeds {
  return modules.map(({ module, reqs }) => {
    const needs = stackOf(reqs.join("\n"));
    const missing = needs.filter((need) => !need.commands.some(here));
    // A version the machine's command does not say is not held against it.
    const older = needs.flatMap((need) => {
      const found = versions.get(need.toolchain);
      return need.version !== undefined && found !== undefined && !missing.includes(need) && olderThan(found, need.version) ? [{ ...need, version: need.version, found }] : [];
    });
    return { module, needs, missing, older };
  });
}

/**
 * The standard library's languages, and what builds and tests their stacks here - every command needed. Python's stacks
 * run through uv, which fetches Python itself; TypeScript's through npm; Java's through the Maven or Gradle wrapper,
 * which needs only Java.
 */
export const STDLIB_LANGUAGES: Array<{ language: string; commands: string[] }> = [
  { language: "Python", commands: ["uv"] },
  { language: "TypeScript", commands: ["node", "npm"] },
  { language: "Go", commands: ["go"] },
  { language: "Rust", commands: ["cargo"] },
  { language: "Java", commands: ["java"] },
];

/** `jdkHere`, without holding the thread up. */
async function jdkHereAsync(): Promise<boolean> {
  return process.platform !== "darwin" || (await spawnAsync("/usr/libexec/java_home", [])).status === 0;
}

/** Whether this machine has a JDK behind `java`: anywhere but macOS, java found says so; on macOS, `java_home` finding one. */
function jdkHere(): boolean {
  return process.platform !== "darwin" || spawnSync("/usr/libexec/java_home", [], { stdio: "ignore" }).status === 0;
}

/**
 * Whether a toolchain's command is really there: `has` finds it - and Java has a JDK behind it as well, for macOS keeps a
 * `/usr/bin/java` that only asks to install one.
 */
export function toolchainCheck(has: (command: string) => boolean, jdk: () => boolean = jdkHere): (command: string) => boolean {
  return (command) => has(command) && (command !== "java" || jdk());
}

const toolchainHere = toolchainCheck(onPath);

/** Which of the standard library's languages this machine can build and test now, and which it lacks a command of. */
export function languagesOnMachine(has: (command: string) => boolean = toolchainHere): { ready: typeof STDLIB_LANGUAGES; missing: typeof STDLIB_LANGUAGES } {
  const ready = STDLIB_LANGUAGES.filter(({ commands }) => commands.every(has));
  return { ready, missing: STDLIB_LANGUAGES.filter((entry) => !ready.includes(entry)) };
}

/**
 * What a spec-writing agent and the conversation are told of this machine before a stack is chosen: the languages it
 * can build now. The agents install nothing, so a stack in a language the machine lacks stops at its first build -
 * offering one is offering a project that cannot be regenerated here until the person installs it.
 */
export function toolchainsBlock(has: (command: string) => boolean = toolchainHere): string {
  const { ready, missing } = languagesOnMachine(has);
  const named = (entries: typeof STDLIB_LANGUAGES) => entries.map(({ language, commands }) => `${language} (${commands.join(", ")})`).join(", ");
  return [
    "<toolchains on this machine>",
    ready.length > 0 ? `It can build and test now: ${named(ready)}.` : "It can build none of the standard library's languages now.",
    ...(missing.length > 0 ? [`It lacks, to build: ${named(missing)} - not installed.`] : []),
    "Every frontend stack - React, Vue, Svelte, Angular - is TypeScript, and needs Node and npm.",
    "Choosing a stack, offer only those in a language it can build now, and choose only among them. A stack in a",
    "language it lacks cannot be regenerated here until the person installs its toolchain - nothing is installed for them;",
    "asked for one anyway, say what to install first, and that `turri doctor` checks it.",
    "</toolchains on this machine>",
  ].join("\n");
}

/** The toolchain commands a testing script is checked for. */
const SCRIPT_COMMANDS = new Set([
  "python3", "python", "pip", "pip3", "pytest", "uv", "poetry", "node", "npm", "npx", "yarn", "pnpm", "bun", "deno", "java", "javac",
  "mvn", "gradle", "go", "cargo", "rustc", "cc", "gcc", "clang", "make", "cmake", "zig", "ruby", "bundle", "php", "composer", "elixir",
  "mix", "dotnet", "flutter", "dart", "swift",
]);

/** Folders of the system a script names a program in by its whole path. */
const SYSTEM_PATH = /(?:^|[\s"'`$(=])(\/(?:usr|opt|Library|Applications|bin|sbin|lib|etc)\/[\w.+/-]+)/g;

/**
 * What in a testing script this machine does not have: a program named by a whole path that is not there - a
 * macOS-only `/usr/libexec/java_home` on Linux - and a toolchain it runs that is not on the PATH. The script is the
 * person's: this is for them to fix, before an agent ever sees it fail.
 */
export function scriptAgainstMachine(
  text: string,
  machine: { has?: (command: string) => boolean; exists?: (path: string) => boolean } = {},
): string[] {
  const has = machine.has ?? onPath;
  const exists = machine.exists ?? existsSync;
  const found: string[] = [];
  const lines = text.split("\n").map((line) => line.replace(/(^|\s)#.*$/, ""));
  for (const line of lines) {
    for (const match of line.matchAll(SYSTEM_PATH)) {
      const path = match[1]!;
      if (!exists(path) && !found.some((item) => item.includes(`\`${path}\``))) found.push(`names \`${path}\`, which this machine does not have`);
    }
    for (const part of line.split(/&&|\|\||[;|]|\$\(|`/)) {
      const words = part.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== "exec" && word !== "export" && word !== "timeout" && !/^\d+[smh]?$/.test(word));
      const command = words[0];
      if (command === undefined || !SCRIPT_COMMANDS.has(command) || has(command)) continue;
      const said = `runs \`${command}\`, which is not on this machine's PATH`;
      if (!found.includes(said)) found.push(said);
    }
  }
  return found;
}

/** A testing script's text, or nothing when it cannot be read. */
export function readScript(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

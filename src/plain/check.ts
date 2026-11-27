import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { testDirOf } from "../config.ts";
import { projectDirOf, resolveTemplateDirs } from "../regenerate/paths.ts";
import { projectTestFiles, testPlainFileRefusal } from "../test-plain-files.ts";
import { plainFileParser, PLAIN_SOURCE_FILE_EXTENSION, PREVIOUS_SYNTAX_HINT } from "./parser.ts";
import {
  ACCEPTANCE_TESTS,
  CONFORMANCE_TESTS,
  getFunctionalSpecs,
  TEST_PLAIN_FILES,
  type MarshalledPlainSource,
  type TestPlainFileBinding,
} from "./spec.ts";

/**
 * The ***plain language's check of a module, with turri's own parser: it parses the module with its test plain files,
 * resolves its imports and required modules, and reports every error the parser can see without generating anything.
 * The parser's errors come one at a time, the first it meets, as the reference gives them. turri's own checks list
 * everything they find at once: every functional spec without a test plain file, and every test plain file that is not
 * where it belongs.
 *
 * What the project adds - its config files, its testing scripts, its base folder - is `checkModule`'s
 * (src/module-check.ts): `turri parse`, the chat's `parse` and the check `regenerate` runs are that one.
 */

export interface CheckedFunctionalSpec {
  funcId: string;
  /** Its test plain files, from the project's folder. */
  testPlainFiles: string[];
  conformance: number;
  acceptance: number;
}

export interface CheckResult {
  /** The module's file - or, for the test folder's check, the test folder. */
  file: string;
  ok: boolean;
  moduleName?: string;
  /** The module's own functional specs, each with its test plain files and how many scenarios they have. */
  functionalSpecs?: CheckedFunctionalSpec[];
  requiredModules?: string[];
  /** The parser's own message, verbatim - it names the line and the construct. */
  error?: string;
  errorType?: string;
  /** turri's next step for the error, when it has one: old syntax, say. */
  nextStep?: string;
  /** turri's own findings, all of them: what is wrong, and what to do about each. */
  problems?: string[];
  /** What does not fail it but leaves something undone: a step of adding tests skipped, and the next step. */
  warnings?: string[];
}

/** Whether a parser error is one the previous ***plain syntax makes. */
export function isPreviousSyntaxError(message: string): boolean {
  return message.includes(PREVIOUS_SYNTAX_HINT) || message.includes("is not allowed in a spec plain file; test scenarios live in test plain files");
}

/** turri's next step for a module in the previous ***plain syntax. */
export function previousSyntaxStep(file: string): string {
  return (
    `${basename(file)} is in the old ***plain syntax. Ask turri to convert it: it goes one module at a time, ` +
    "proposing func-ids and test plain files, and asks you before writing anything."
  );
}

/** A path from the project's folder, as a person reads it. */
function shown(path: string, projectDir: string): string {
  return relative(projectDir, resolve(path)).split(sep).join("/");
}

/** A module parsed and checked by the language: its result, and - when it parsed - its tree and template folders. */
export interface ParsedCheck {
  result: CheckResult;
  parsed?: { path: string; moduleName: string; tree: MarshalledPlainSource; requiredModules: string[]; dirs: string[] };
}

/** The language's check of a module, with what it parsed - for the project's check to go on from. */
export function checkParsed(file: string, templateDirs: string[] = []): ParsedCheck {
  const path = resolve(file);

  if (extname(path) !== PLAIN_SOURCE_FILE_EXTENSION) {
    return { result: { file, ok: false, error: `Not a ${PLAIN_SOURCE_FILE_EXTENSION} file.`, errorType: "UsageError" } };
  }
  if (!existsSync(path)) {
    return { result: { file, ok: false, error: "File does not exist.", errorType: "UsageError" } };
  }
  const refusal = testPlainFileRefusal(path);
  if (refusal !== undefined) return { result: { file, ok: false, error: refusal, errorType: "UsageError" } };

  const projectDir = projectDirOf(path);
  try {
    const dirs = resolveTemplateDirs(path, templateDirs);
    // A module with no functional specs yet is valid - it is how every module starts, and how
    // an import module always is. It is reported, not failed.
    const [moduleName, tree, requiredModules] = plainFileParser(basename(path), dirs, {
      allowNoFunctionalities: true,
      testDir: testDirOf(path),
      requireTestPlainFiles: false,
    });
    const bindings = Object.entries((tree[TEST_PLAIN_FILES] as Record<string, TestPlainFileBinding> | undefined) ?? {});
    return {
      result: {
        file,
        ok: true,
        moduleName,
        functionalSpecs: getFunctionalSpecs(tree).map((item) => ({
          funcId: item.id,
          testPlainFiles: bindings
            .filter(([, binding]) => binding.module === moduleName && binding.func_id === item.id)
            .map(([name]) => shown(join(dirs[0]!, name), projectDir)),
          conformance: item[CONFORMANCE_TESTS].length,
          acceptance: item[ACCEPTANCE_TESTS].length,
        })),
        requiredModules,
      },
      parsed: { path, moduleName, tree, requiredModules, dirs },
    };
  } catch (error) {
    return { result: failedCheck(file, error) };
  }
}

/** A check that failed on an error: its message verbatim, and turri's next step when it has one. */
export function failedCheck(file: string, error: unknown): CheckResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    file,
    ok: false,
    error: message,
    errorType: error instanceof Error ? error.name : "Error",
    ...(isPreviousSyntaxError(message) ? { nextStep: previousSyntaxStep(resolve(file)) } : {}),
  };
}

/**
 * The ***plain language's check of one module: parsed with its test plain files, its imports and required modules
 * resolved. `checkModule` (`@turri-dev/core/project`) adds what the project says of it.
 */
export function checkPlainFile(file: string, templateDirs: string[] = []): CheckResult {
  return checkParsed(file, templateDirs).result;
}

/** The check of a project's test folder: every test plain file not where it belongs. Undefined when there is none. */
export function checkTestFolder(projectDir: string): CheckResult | undefined {
  const strays = projectTestFiles(projectDir).filter((file) => file.problem !== undefined);
  if (strays.length === 0) return undefined;
  return {
    file: [...new Set(strays.map(({ testDir }) => `${shown(testDir, projectDir)}${sep}`))].join(", "),
    ok: false,
    errorType: `${strays.length} test plain file${strays.length === 1 ? "" : "s"} outside a module's folder`,
    problems: strays.map((stray) => `${stray.file} - ${stray.problem}`),
  };
}

/** Every `.plain` file directly in a directory, or the single file given. */
export function resolvePlainTargets(target: string): string[] {
  const path = resolve(target);
  if (existsSync(path) && statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((entry) => entry.endsWith(PLAIN_SOURCE_FILE_EXTENSION))
      .sort()
      .map((entry) => join(path, entry));
  }
  return [path];
}

/**
 * Check a file, or every .plain file directly in a folder - never a test folder, which holds no module - and then the
 * project's test folder, once, at the end.
 */
export function checkPlainTargets(target: string, templateDirs: string[] = []): CheckResult[] {
  return checkTargets(target, (file) => checkPlainFile(file, templateDirs));
}

/** `checkPlainTargets` with each module checked by `check`. */
export function checkTargets(target: string, check: (file: string) => CheckResult): CheckResult[] {
  const path = resolve(target);
  if (existsSync(path) && statSync(path).isDirectory()) {
    const refusal = testPlainFileRefusal(path);
    if (refusal !== undefined) return [{ file: target, ok: false, error: refusal, errorType: "UsageError" }];
  }
  const files = resolvePlainTargets(target);
  const results = files.map(check);
  for (const project of new Set(files.map((file) => projectDirOf(file)))) {
    const folder = checkTestFolder(project);
    if (folder !== undefined) results.push(folder);
  }
  return results;
}

/** Columns padded to their widest cell, each line indented under the module's. */
function columns(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((acc, row) => row.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)), []);
  return rows.map((row) => `        ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]!))).join("  ")}`);
}

/** How many scenarios a functional spec has, or that it has none and so is not tested. */
function scenarioCounts(spec: CheckedFunctionalSpec): string {
  const counts = [spec.conformance > 0 ? `${spec.conformance} conformance` : "", spec.acceptance > 0 ? `${spec.acceptance} acceptance` : ""].filter(Boolean);
  return counts.length === 0 ? "no scenarios - not tested" : counts.join(", ");
}

/**
 * One line per file, plus the parser's message under any that failed and turri's next step, or every problem turri
 * found; a module that passed, its functional specs under it, each with its test plain file and its scenarios - and
 * a WARN line for each warning, a step of adding tests it skipped.
 */
export function formatCheckResults(results: CheckResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const name = result.file.endsWith(sep) ? result.file : basename(result.file);
    if (result.ok) {
      const specs = result.functionalSpecs ?? [];
      const requires =
        result.requiredModules && result.requiredModules.length > 0 ? `, requires ${result.requiredModules.join(", ")}` : "";
      lines.push(
        specs.length === 0
          ? `PASS  ${name}  no functional specs yet${requires}`
          : `PASS  ${name}  ${specs.length} functional spec${specs.length === 1 ? "" : "s"}${requires}`,
      );
      // No test plain file is a functional spec not tested - the one way to say so: an empty one is a syntax error.
      lines.push(...columns(specs.map((spec) => [spec.funcId, spec.testPlainFiles.length > 0 ? spec.testPlainFiles.join(", ") : "no test plain file", scenarioCounts(spec)])));
      for (const warning of result.warnings ?? []) lines.push(`WARN  ${name}  ${warning}`);
    } else {
      lines.push(`FAIL  ${name}  ${result.errorType ?? "Error"}`);
      for (const line of [...(result.error ?? "").split("\n").filter((line, index) => index > 0 || line !== ""), ...(result.problems ?? [])]) lines.push(`        ${line}`);
      if (result.nextStep !== undefined) lines.push(`        ${result.nextStep}`);
    }
  }
  return lines.join("\n");
}

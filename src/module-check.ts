import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { configModuleFor, testDirOf } from "./config.ts";
import { conformanceTestsOn } from "./conformance-switch.ts";
import { checkParsed, checkTargets, failedCheck, type CheckResult } from "./plain/check.ts";
import { plainFileParser, PLAIN_SOURCE_FILE_EXTENSION, readPlainSourceMetadata, REQUIRES_DIRECTIVE } from "./plain/parser.ts";
import type { MarshalledPlainSource } from "./plain/spec.ts";
import { missingBaseFolder } from "./regenerate/base-folder.ts";
import { projectDirOf, resolveTemplateDirs } from "./regenerate/paths.ts";
import { testedFuncIds } from "./regenerate/records.ts";
import { isImportModule } from "./regenerate/requires-chain.ts";
import { testingGap } from "./regenerate/testing-steps.ts";
import { projectModules } from "./test-plain-files.ts";

/**
 * A module checked in its project - `turri parse`, the chat's `parse`, and the check `regenerate` runs on the module it
 * is given: the ***plain language's check (`checkPlainFile`), then what the project says of the module. Two config
 * files among the modules it requires fail it, as a syntax error does. A step of adding tests it skipped - scenarios
 * with no test reqs, or no conformance testing script - and a base folder that is not there pass it with a warning.
 */
export function checkModule(file: string, templateDirs: string[] = []): CheckResult {
  const { result, parsed } = checkParsed(file, templateDirs);
  if (parsed === undefined) return result;
  const { path, moduleName, tree, requiredModules } = parsed;
  try {
    // Two config files among the modules it requires: which one builds it cannot be told.
    configModuleFor(path);
  } catch (error) {
    return failedCheck(file, error);
  }
  const warnings = testingGapsOf(moduleName, path, tree, projectDirOf(path), templateDirs);
  // A codebase that requires nothing starts from its base folder: one named and not there stops its first pulse.
  const base = requiredModules.length === 0 && !isImportModule(path) ? missingBaseFolder(path) : undefined;
  if (base !== undefined) warnings.push(base);
  // In the order the result is read: what the module is, what it skipped, then its functional specs.
  if (warnings.length === 0) return result;
  const { file: checked, ok, moduleName: _name, ...rest } = result;
  return { file: checked, ok, moduleName, warnings, ...rest };
}

/**
 * Check a file, or every .plain file directly in a folder, in its project - never a test folder, which holds no module -
 * and then the project's test folder, once, at the end.
 */
export function checkModules(target: string, templateDirs: string[] = []): CheckResult[] {
  return checkTargets(target, (file) => checkModule(file, templateDirs));
}

/**
 * The modules of a project whose requires chains a module is in and that nothing requires: the tips its conformance
 * tests are written in, by name with their files. None when nothing requires it - it is a tip itself.
 */
function tipsAbove(moduleName: string, projectDir: string): Array<{ name: string; file: string }> {
  const modules = projectModules(projectDir);
  const requiredBy = new Map<string, string[]>();
  for (const [name, file] of modules) {
    let requires: string[] = [];
    try {
      requires = (readPlainSourceMetadata(readFileSync(file, "utf8")).metadata[REQUIRES_DIRECTIVE] as string[] | undefined) ?? [];
    } catch {
      continue;
    }
    for (const required of requires) {
      const below = basename(required.replace(/^\.\//, ""), PLAIN_SOURCE_FILE_EXTENSION);
      requiredBy.set(below, [...(requiredBy.get(below) ?? []), name]);
    }
  }
  const tips = new Set<string>();
  const seen = new Set<string>();
  const up = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const above = requiredBy.get(name) ?? [];
    if (above.length === 0 && name !== moduleName) tips.add(name);
    for (const next of above) up(next);
  };
  up(moduleName);
  return [...tips].sort().flatMap((name) => (modules.has(name) ? [{ name, file: modules.get(name)! }] : []));
}

/**
 * The steps of adding tests a module skipped, as warnings. A module another requires has its conformance tests
 * written in the tips above it, from their test reqs and with their script: it is judged by each of them, which says so.
 */
function testingGapsOf(moduleName: string, path: string, tree: MarshalledPlainSource, projectDir: string, templateDirs: string[]): string[] {
  // Conformance tests off: no step of adding them is skipped - and scenarios written are said not to be tested.
  if (!conformanceTestsOn(path)) {
    const tested = testedFuncIds(tree);
    return tested.length > 0
      ? [`its scenarios are not tested - ${tested.map((funcId) => `${moduleName}:${funcId}`).join(", ")}: conformance tests are off (conformance-tests: false, or unset). /conform in the chat turns them on, or conformance-tests: true in config.turri.yaml.`]
      : [];
  }
  const tips = tipsAbove(moduleName, projectDir);
  if (tips.length === 0) {
    const gap = testingGap({ moduleName, plainFile: path, tree });
    return gap !== undefined ? [gap.text] : [];
  }
  return tips.flatMap((tip) => {
    let tipTree: MarshalledPlainSource;
    try {
      [, tipTree] = plainFileParser(basename(tip.file), resolveTemplateDirs(tip.file, templateDirs), {
        allowNoFunctionalities: true,
        testDir: testDirOf(tip.file),
        requireTestPlainFiles: false,
      });
    } catch {
      // A tip that does not parse is reported when it is checked itself.
      return [];
    }
    const gap = testingGap({ moduleName: tip.name, plainFile: tip.file, tree: tipTree });
    return gap !== undefined ? [`${moduleName}'s conformance tests are written in ${tip.name}, which requires it: ${gap.text}`] : [];
  });
}

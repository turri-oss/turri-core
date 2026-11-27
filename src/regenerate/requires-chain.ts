import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { IMPORT_DIRECTIVE, PLAIN_SOURCE_FILE_EXTENSION, plainFileParser, readPlainSourceMetadata, REQUIRES_DIRECTIVE, withParseCache, type ParseOptions } from "../plain/parser.ts";
import { getFrids } from "../plain/spec.ts";
import { buildDirUnder, modulesRoot, projectDirOf, resolveTemplateDirs } from "./paths.ts";

/**
 * A module's requires chain and a project's build order, from its .plain files alone - kept apart from what builds the
 * chain's codebases, so what only reads ***plain (the parser's entry) loads none of the harness.
 */

export interface ChainEntry {
  moduleName: string;
  plainFile: string;
  buildDir: string;
  /** The module whose code is copied in before this one is built. */
  requires: string | null;
  funcIds: string[];
}

/** A required module's file: the first template folder that has it. */
export function locateModule(moduleName: string, templateDirs: string[]): string {
  for (const dir of templateDirs) {
    const candidate = join(dir, moduleName + PLAIN_SOURCE_FILE_EXTENSION);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Required module '${moduleName}' not found in: ${templateDirs.join(", ")}`);
}

/**
 * The chain to build, bottom first.
 *
 * Depth-first, post-order: everything a module requires is listed before the module
 * itself. The parser has already rejected circular requires, and a module reached twice is
 * emitted once.
 */
export function resolveRequiresChain(
  plainFile: string,
  templateDirs: string[] = [],
  buildRoot?: string,
  /** Accept the named module without functional specs yet. Those it requires must have them. */
  options: ParseOptions = {},
): ChainEntry[] {
  const dirs = resolveTemplateDirs(plainFile, templateDirs);
  const root = resolve(buildRoot ?? modulesRoot(projectDirOf(plainFile)));
  const chain: ChainEntry[] = [];
  const seen = new Set<string>();

  const visit = (file: string, requiredBy: string[]): string => {
    const [moduleName, tree, requires] = plainFileParser(basename(file), dirs, requiredBy.length === 0 ? options : {});

    if (requiredBy.includes(moduleName)) {
      throw new Error(`Circular requires: ${[...requiredBy, moduleName].join(" -> ")}`);
    }
    if (seen.has(moduleName)) return moduleName;

    let previous: string | null = null;
    for (const required of requires) {
      previous = visit(locateModule(required, dirs), [...requiredBy, moduleName]);
    }

    seen.add(moduleName);
    chain.push({
      moduleName,
      plainFile: resolve(file),
      buildDir: buildDirUnder(root, moduleName),
      requires: previous,
      funcIds: [...getFrids(tree)],
    });
    return moduleName;
  };

  visit(resolve(plainFile), []);
  return chain;
}

/** Every .plain file in a project's folder, sorted - the modules a host lists. */
export function projectPlainFiles(projectDir: string): string[] {
  const root = resolve(projectDir);
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(PLAIN_SOURCE_FILE_EXTENSION))
      .map((entry) => join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * A project's .plain files in the order they are built: each after every module it requires, as its requires chain has
 * them (`resolveRequiresChain`) - taken in the order given, by name without `files`, each brought in after what it
 * requires. A module whose chain does not resolve - it does not parse, a module it requires is not there, a cycle - goes
 * after what its front matter says it requires, as far as those are found. `files`, absolute or from the project: the
 * ones to order, every other module of a chain left out; without it, every .plain file in the project's folder.
 */
export function requiresOrder(projectDir: string, options: { files?: string[] } = {}): string[] {
  const root = resolve(projectDir);
  const files = (options.files ?? projectPlainFiles(root)).map((file) => resolve(root, file));
  const wanted = new Set(files);
  const order: string[] = [];
  const placed = new Set<string>();
  const add = (file: string) => {
    if (placed.has(file)) return;
    placed.add(file);
    if (wanted.has(file)) order.push(file);
  };
  const visiting = new Set<string>();
  const place = (file: string) => {
    if (placed.has(file) || visiting.has(file)) return;
    visiting.add(file);
    try {
      for (const entry of resolveRequiresChain(file, [], undefined, { allowNoFunctionalities: true })) add(entry.plainFile);
    } catch {
      let requires: string[] = [];
      try {
        requires = ((readPlainSourceMetadata(readFileSync(file, "utf8")).metadata[REQUIRES_DIRECTIVE] as unknown[] | undefined) ?? []).filter((name): name is string => typeof name === "string");
      } catch {
        // Not read: nothing to put it after.
      }
      const dirs = resolveTemplateDirs(file);
      for (const name of requires) {
        try {
          place(resolve(locateModule(name, dirs)));
        } catch {
          // Not there: nothing to put it after.
        }
      }
      add(file);
    }
    visiting.delete(file);
  };
  withParseCache(() => {
    for (const file of files) place(file);
  });
  return order;
}

/** The .plain files that import `plainFile` - read from beside it, and, kept in a `template/` folder, from the folder it is in. */
function importersOf(plainFile: string): string[] {
  const file = resolve(plainFile);
  const dir = dirname(file);
  const name = basename(file, PLAIN_SOURCE_FILE_EXTENSION);
  const dirs = [dir, ...(basename(dir) === "template" ? [dirname(dir)] : [])];
  return dirs.flatMap((at) => {
    let names: string[];
    try {
      names = readdirSync(at).filter((entry) => entry.endsWith(PLAIN_SOURCE_FILE_EXTENSION));
    } catch {
      return [];
    }
    return names
      .map((entry) => join(at, entry))
      .filter((path) => {
        if (path === file || !resolveTemplateDirs(path).includes(dir)) return false;
        try {
          return ((readPlainSourceMetadata(readFileSync(path, "utf8")).metadata[IMPORT_DIRECTIVE] as string[] | undefined) ?? []).includes(name);
        } catch {
          return false;
        }
      });
  });
}

/**
 * Whether a .plain file is an import module - one a .plain file imports, or one kept in a `template/` folder - rather than
 * a module of its own. It is no codebase: its reqs and definitions are built in the modules that import it.
 */
export function isImportModule(plainFile: string): boolean {
  return basename(dirname(resolve(plainFile))) === "template" || importersOf(plainFile).length > 0;
}

/** The modules of their own that import an import module, through any import modules between. */
export function importingModules(plainFile: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const importer of importersOf(file)) {
      if (isImportModule(importer)) walk(importer);
      else found.add(importer);
    }
  };
  walk(resolve(plainFile));
  return [...found];
}

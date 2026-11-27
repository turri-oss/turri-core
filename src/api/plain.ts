import { projectStanding as standing } from "../regenerate/standing.ts";

/** A worker's read-only view of the project on disk. A running session also knows its live work. */
export function projectStanding(projectDir: string, files?: string[]) {
  return standing(projectDir, { files });
}
export { requiresOrder } from "../regenerate/requires.ts";
export { resolveTemplateDirs } from "../regenerate/paths.ts";
export { checkPlainFile, checkPlainTargets, formatCheckResults, type CheckResult } from "../plain/check.ts";
export { plainFileParser } from "../plain/parser.ts";
export { ACCEPTANCE_TEST_HEADING, CONFORMANCE_TEST_HEADING, DEFINITIONS, FUNCTIONAL_REQUIREMENTS, NON_FUNCTIONAL_REQUIREMENTS, TEST_REQUIREMENTS, iterateFunctionalSpecs } from "../plain/spec.ts";
export { highlightLine, highlightLines, roleOf, type HighlightState, type PlainRole, type Token } from "../plain/highlight.ts";
export { RESOURCE_MARKER } from "../plain/markdown.ts";
export { conceptsOf, type ModuleConcept } from "../plain/module-concepts.ts";
export { conceptBeingTyped, findConcepts } from "../plain/concepts.ts";
export { plainGraph, type PlainConceptNode, type PlainGraph, type PlainItemNode, type PlainLink, type PlainModuleNode, type PlainScenario, type PlainSection, type PlainTestPlainFileNode } from "../plain/graph.ts";
export { isStack, STDLIB_KINDS, stdlibTemplates, type StdlibKind, type StdlibTemplate } from "../stdlib.ts";

/** `@turri-dev/core/plain`: the ***plain language - parsing and checking it, its graph and concepts, highlighting it, and the standard library's stacks. */
export { requiresOrder } from "../regenerate/requires-chain.ts";
export { resolveTemplateDirs } from "../regenerate/paths.ts";
export { checkPlainFile, checkPlainTargets, formatCheckResults, type CheckedFunctionalSpec, type CheckResult } from "../plain/check.ts";
export { plainFileParser, type ParseOptions } from "../plain/parser.ts";
export { ACCEPTANCE_TEST_HEADING, ACCEPTANCE_TESTS, CONFORMANCE_TEST_HEADING, CONFORMANCE_TESTS, DEFINITIONS, FUNCTIONAL_REQUIREMENTS, NON_FUNCTIONAL_REQUIREMENTS, TEST_REQUIREMENTS, iterateFunctionalSpecs, type MarshalledPlainSource, type ScenarioText, type Specifications } from "../plain/spec.ts";
export { highlightLine, highlightLines, roleOf, type HighlightState, type PlainRole, type Token } from "../plain/highlight.ts";
export { RESOURCE_MARKER } from "../plain/markdown.ts";
export { conceptsOf, type ModuleConcept } from "../plain/module-concepts.ts";
export { conceptBeingTyped, findConcepts } from "../plain/concepts.ts";
export { plainGraph, type PlainConceptNode, type PlainGraph, type PlainItemNode, type PlainLink, type PlainModuleNode, type PlainScenario, type PlainSection, type PlainTestPlainFileNode } from "../plain/graph.ts";
export { isStack, STDLIB_KINDS, stdlibTemplates, type StdlibKind, type StdlibTemplate } from "../stdlib.ts";
export { DIFF_HEADER, locateDiffLines, type DiffWhere } from "../regenerate/diff-where.ts";

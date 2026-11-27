import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The core's boundary with the terminal. What only a screen needs - pi-tui, pi's interactive mode and the parts it draws
 * with, entry and message renderers, keys, the footer, header and editor, the terminal's input - is turri's CLI's, which
 * draws the core through its view (src/view.ts). Each file under src/ is read by its syntax, so a comment or a string
 * that names one of them is not a crossing. Beyond it: a name read through a key computed at run time (`pi[key]`), and a
 * ui or pi's API the file reaches without naming it - one a call returns, or one typed by an interface of its own.
 */

const PI_TUI = "@earendil-works/pi-tui";
const PI = "@earendil-works/pi-coding-agent";
/**
 * pi's terminal: its interactive mode, the runtime whose session a screen swaps, its command line - and what it draws
 * with: its components (every name ending in Component), borders, loader, editor, key hints, diffs and themes.
 */
const TERMINAL_PARTS = new Set([
  "InteractiveMode",
  "UserMessageComponent",
  "getMarkdownTheme",
  "AgentSessionRuntime",
  "main",
  "DynamicBorder",
  "BorderedLoader",
  "CustomEditor",
  "keyHint",
  "keyText",
  "rawKeyHint",
  "renderDiff",
  "initTheme",
  "getSelectListTheme",
  "getSettingsListTheme",
]);
const isTerminalPart = (name: string) => TERMINAL_PARTS.has(name) || name.endsWith("Component");
/** What only a screen does: draw an entry or a message, take a key, put in its own footer, header or editor, read the terminal's input. */
const SCREEN_CALLS = new Set(["registerEntryRenderer", "registerMessageRenderer", "registerShortcut", "setFooter", "setHeader", "setEditorComponent", "onTerminalInput"]);

/**
 * Where a core file passes one of those on, doing nothing of its own with it - each site by its file, the function it is
 * in and what it is read from: a chat's scope hands pi's own registerShortcut its handler run in the chat (chats.ts,
 * scopedToChat, on the proxy's `target`); a hidden chat's stand-in for the screen passes a terminal input handler on to
 * the screen it is shown on, now (`screen`) or once shown (`next`) (chat-ui.ts, createChatUi). Anywhere else in those
 * files, it is a crossing.
 */
interface PassedOn {
  file: string;
  within: string;
  on: string;
  name: string;
}
const PASSED_ON: PassedOn[] = [
  { file: "src/chats.ts", within: "scopedToChat", on: "target", name: "registerShortcut" },
  { file: "src/chat-ui.ts", within: "createChatUi", on: "screen", name: "onTerminalInput" },
  { file: "src/chat-ui.ts", within: "createChatUi", on: "next", name: "onTerminalInput" },
];
const siteOf = (site: PassedOn) => `${site.file} ${site.within}: ${site.on}.${site.name}`;

type Rule = "pi-tui" | "terminal-part" | "screen-call";
interface Crossing {
  rule: Rule;
  /** `src/<file>:<line> <what it does>` */
  message: string;
}

const isPiTui = (spec: string) => spec === PI_TUI || spec.startsWith(`${PI_TUI}/`);
const isPi = (spec: string) => spec === PI || spec.startsWith(`${PI}/`);
const stringOf = (node: ts.Node | undefined) => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined);
/** A property's name as written: `x.name`, `x["name"]`, `{ name }`, `{ name: alias }`, `{ "name": alias }`. */
const nameOf = (node: ts.Node | undefined) =>
  node !== undefined && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : undefined;
/** What an expression is once its parentheses, casts and `!` are taken off. */
const bare = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isNonNullExpression(at) || ts.isSatisfiesExpression(at) || ts.isTypeAssertionExpression(at)) at = at.expression;
  return at;
};

/** Every crossing in one file's text, `file` named from the repository's root with `/`; `passed` is told each site PASSED_ON let by. */
function crossings(file: string, text: string, passed: (site: string) => void = () => {}): Crossing[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Crossing[] = [];
  const at = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const cross = (rule: Rule, node: ts.Node, what: string) => found.push({ rule, message: `${at(node)} ${what}` });
  const fromPiTui = (node: ts.Node, spec: string | undefined) => {
    if (spec !== undefined && isPiTui(spec)) cross("pi-tui", node, `imports ${spec} - the terminal's`);
  };
  const part = (node: ts.Node, name: string) => {
    if (isTerminalPart(name)) cross("terminal-part", node, `imports ${name} from ${PI} - the terminal's`);
  };
  // pi's whole API under one name - `import * as P from pi`, `const P = await import(pi)`, `const Q = P`: what is read
  // through it, or taken out of it by name, is taken from it too.
  const namespaces = new Set<string>();
  const isNamespace = (node: ts.Expression | undefined) => node !== undefined && ts.isIdentifier(bare(node)) && namespaces.has((bare(node) as ts.Identifier).text);
  /** pi's whole API, imported then and there: `await import(pi)`, `require(pi)`. */
  const importsPi = (node: ts.Expression): boolean => {
    let at = bare(node);
    if (ts.isAwaitExpression(at)) at = bare(at.expression);
    if (!ts.isCallExpression(at)) return false;
    const loads = at.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(at.expression) && at.expression.text === "require");
    return loads && isPi(stringOf(at.arguments[0]) ?? "");
  };
  // What a ui is read through: `ui`, `x.ui`, `x["ui"]`, a name given one - `const io = ctx.ui`, `const { ui: io } = ctx`,
  // `screen: ExtensionUIContext` - or anything cast to one, `(x as ExtensionContext["ui"])`.
  const uiNames = new Set<string>(["ui"]);
  const isUi = (node: ts.Expression | undefined): boolean => {
    if (node === undefined) return false;
    for (let at = node; ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isNonNullExpression(at) || ts.isSatisfiesExpression(at) || ts.isTypeAssertionExpression(at); at = at.expression) {
      if (!ts.isParenthesizedExpression(at) && !ts.isNonNullExpression(at) && namesUiType(at.type)) return true;
    }
    const at = bare(node);
    if (ts.isIdentifier(at)) return uiNames.has(at.text);
    if (ts.isPropertyAccessExpression(at)) return at.name.text === "ui";
    if (ts.isElementAccessExpression(at)) return stringOf(at.argumentExpression) === "ui";
    return false;
  };
  // The types of a ui: pi's, and the file's own names for one - `type Screen = ExtensionContext["ui"]`.
  const uiTypes = new Set<string>(["ExtensionUIContext"]);
  /**
   * Whether a type is a ui's, or has one in it: `ExtensionUIContext`, `pi.ExtensionUIContext`, a name the file gave one,
   * a context's ui by its key - `ExtensionContext["ui"]`, `ExtensionCommandContext["ui"]`, any type's `["ui"]` - or
   * `typeof ctx.ui`.
   */
  const namesUiType = (type: ts.TypeNode | undefined): boolean => {
    let named = false;
    const look = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && uiTypes.has(ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text)) named = true;
      if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType) && stringOf(node.indexType.literal) === "ui") named = true;
      if (ts.isTypeQueryNode(node) && ts.isQualifiedName(node.exprName) && node.exprName.right.text === "ui") named = true;
      ts.forEachChild(node, look);
    };
    if (type !== undefined) look(type);
    return named;
  };
  const gather = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isPi(stringOf(node.moduleSpecifier) ?? "")) {
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && (isNamespace(node.initializer) || importsPi(node.initializer))) {
      namespaces.add(node.name.text);
    }
    if (ts.isTypeAliasDeclaration(node) && namesUiType(node.type)) uiTypes.add(node.name.text);
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      if (namesUiType(node.type) || (node.initializer !== undefined && isUi(node.initializer))) uiNames.add(node.name.text);
    }
    if (ts.isBindingElement(node) && nameOf(node.propertyName) === "ui" && ts.isIdentifier(node.name)) uiNames.add(node.name.text);
    ts.forEachChild(node, gather);
  };
  // Until nothing more is found: a name given a ui, a ui's type or pi's API can give it another, declared before or after it.
  for (let known = -1; known !== namespaces.size + uiNames.size + uiTypes.size; ) {
    known = namespaces.size + uiNames.size + uiTypes.size;
    gather(source);
  }

  /** The named function a node is in, nearest first. */
  const within = (node: ts.Node): string | undefined => {
    for (let up = node.parent; up !== undefined; up = up.parent) if (ts.isFunctionDeclaration(up) && up.name !== undefined) return up.name.text;
    return undefined;
  };
  /** A screen call's name read - called, kept or passed - from `on`, unless it is a site PASSED_ON. */
  const screenCall = (node: ts.Node, name: string, on: ts.Expression | undefined) => {
    if (!SCREEN_CALLS.has(name)) return;
    const from = on !== undefined && ts.isIdentifier(bare(on)) ? (bare(on) as ts.Identifier).text : undefined;
    const site = PASSED_ON.find((each) => each.file === file && each.name === name && each.on === from && each.within === within(node));
    if (site !== undefined) return passed(siteOf(site));
    cross("screen-call", node, `uses ${name} - the terminal's view does`);
  };
  const custom = (node: ts.Node, name: string | undefined, on: boolean) => {
    if (name === "custom" && on) cross("screen-call", node, "uses ui.custom - the terminal's view does");
  };
  /** Whether a destructuring takes its names from a ui: `const { custom } = ctx.ui`, `const { ui: { custom } } = ctx`, `({ custom }: ExtensionUIContext) =>`. */
  const fromUi = (pattern: ts.ObjectBindingPattern): boolean => {
    const holder = pattern.parent;
    if (ts.isVariableDeclaration(holder)) return (holder.initializer !== undefined && isUi(holder.initializer)) || namesUiType(holder.type);
    if (ts.isParameter(holder)) return namesUiType(holder.type);
    if (ts.isBindingElement(holder)) return nameOf(holder.propertyName) === "ui";
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = stringOf(node.moduleSpecifier);
      fromPiTui(node, spec);
      const bindings = node.importClause?.namedBindings;
      if (spec !== undefined && isPi(spec) && bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) part(element, (element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportDeclaration(node)) {
      const spec = stringOf(node.moduleSpecifier);
      fromPiTui(node, spec);
      if (spec !== undefined && isPi(spec) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) part(element, (element.propertyName ?? element.name).text);
      }
      // pi re-exported whole, its terminal with it: `export * from pi`, `export * as name from pi`, `export { P }`.
      const whole = (as: string | undefined) => {
        cross("terminal-part", node, `re-exports the whole of ${PI}${as !== undefined ? ` as ${as}` : ""} - its terminal with it`);
      };
      if (spec !== undefined && isPi(spec) && node.exportClause === undefined) whole(undefined);
      if (spec !== undefined && isPi(spec) && node.exportClause !== undefined && ts.isNamespaceExport(node.exportClause)) whole(nameOf(node.exportClause.name));
      if (spec === undefined && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) if (namespaces.has((element.propertyName ?? element.name).text)) whole(element.name.text);
      }
    } else if (ts.isImportTypeNode(node)) {
      const spec = ts.isLiteralTypeNode(node.argument) ? stringOf(node.argument.literal) : undefined;
      fromPiTui(node, spec);
      if (spec !== undefined && isPi(spec) && node.qualifier !== undefined) {
        // `import(pi).InteractiveMode`, or a name inside it: `import(pi).InteractiveMode.Options`
        let first: ts.EntityName = node.qualifier;
        while (ts.isQualifiedName(first)) first = first.left;
        part(node, first.text);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        const spec = stringOf(node.arguments[0]);
        fromPiTui(node, spec);
        if (spec !== undefined && isPi(spec)) {
          // `const { main } = await import(pi)`, `(await import(pi)).main`
          const result = ts.isAwaitExpression(node.parent) ? node.parent : node;
          let user: ts.Node = result.parent;
          while (ts.isParenthesizedExpression(user)) user = user.parent;
          if (ts.isVariableDeclaration(user) && ts.isObjectBindingPattern(user.name)) {
            for (const element of user.name.elements) {
              const name = element.propertyName ?? element.name;
              if (ts.isIdentifier(name)) part(element, name.text);
            }
          } else if (ts.isPropertyAccessExpression(user)) part(user, user.name.text);
        }
      }
      // A screen call by its bare name: one imported, or taken from pi or a ui before.
      if (ts.isIdentifier(node.expression) && SCREEN_CALLS.has(node.expression.text)) cross("screen-call", node, `calls ${node.expression.text} - the terminal's view does`);
    } else if (ts.isPropertyAccessExpression(node)) {
      // Read, whatever is done with it: `pi.registerShortcut(...)`, `const reg = pi.registerEntryRenderer`, `ctx.ui?.custom`.
      if (isNamespace(node.expression)) part(node, node.name.text);
      screenCall(node, node.name.text, node.expression);
      custom(node, node.name.text, isUi(node.expression));
    } else if (ts.isElementAccessExpression(node)) {
      const name = stringOf(node.argumentExpression);
      if (name !== undefined) {
        if (isNamespace(node.expression)) part(node, name);
        screenCall(node, name, node.expression);
        custom(node, name, isUi(node.expression));
      }
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      // Taken out by name: `const { registerShortcut } = pi`, `const { custom: open } = ctx.ui`, `const { InteractiveMode } = P`.
      const name = nameOf(node.propertyName ?? node.name);
      if (name !== undefined) {
        const holder = node.parent.parent;
        if (ts.isVariableDeclaration(holder) && isNamespace(holder.initializer)) part(node, name);
        screenCall(node, name, undefined);
        custom(node, name, fromUi(node.parent));
      }
    } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left) && namespaces.has(node.left.text)) {
      part(node, node.right.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every .ts file of the core, named from the repository's root with `/`. */
function coreFiles(): Array<{ file: string; text: string }> {
  return readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .sort()
    .map((path) => ({ file: `src/${path.split(sep).join("/")}`, text: readFileSync(join("src", path), "utf8") }));
}

const inCore = (rule: Rule) => coreFiles().flatMap(({ file, text }) => crossings(file, text)).filter((crossing) => crossing.rule === rule).map((crossing) => crossing.message);

describe("the core's boundary with the terminal", () => {
  it("reads every file of the core", () => {
    const files = coreFiles().map((each) => each.file);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining(["src/extension.ts", "src/view.ts", "src/regenerate/loop.ts"]));
  });

  it("imports no pi-tui, including for text measurement", () => {
    const found = inCore("pi-tui");
    expect(found, found.join("\n")).toEqual([]);
  });

  it("imports none of pi's terminal - its interactive mode, its components and what else it draws with, its session runtime, its command line", () => {
    const found = inCore("terminal-part");
    expect(found, found.join("\n")).toEqual([]);
  });

  it("registers no renderer or key, puts in no footer, header or editor, opens no custom component and reads no terminal input", () => {
    const found = inCore("screen-call");
    expect(found, found.join("\n")).toEqual([]);
  });

  it("lets pi's registerShortcut and onTerminalInput be passed on at their three sites alone, each still there", () => {
    const passed: string[] = [];
    for (const { file, text } of coreFiles()) crossings(file, text, (site) => passed.push(site));
    expect(passed.sort()).toEqual(PASSED_ON.map(siteOf).sort());
  });

  it("finds pi's registerShortcut and onTerminalInput used anywhere else in the files that pass them on", () => {
    const chats = readFileSync("src/chats.ts", "utf8");
    const chatUi = readFileSync("src/chat-ui.ts", "utf8");
    const lines = (text: string) => text.split("\n").length;
    expect(crossings("src/chats.ts", `${chats}\nexport function more(pi: ExtensionAPI) {\n  pi.registerShortcut("ctrl+h", { handler() {} });\n}\n`).map((crossing) => crossing.message)).toEqual([
      `src/chats.ts:${lines(chats) + 2} uses registerShortcut - the terminal's view does`,
    ]);
    expect(crossings("src/chat-ui.ts", `${chatUi}\nexport function more(screen: ExtensionUIContext) {\n  screen.onTerminalInput(() => undefined);\n}\n`).map((crossing) => crossing.message)).toEqual([
      `src/chat-ui.ts:${lines(chatUi) + 2} uses onTerminalInput - the terminal's view does`,
    ]);
  });

  it("finds each crossing by the syntax - naming its file and line - and none in a comment or a string", () => {
    const text = [
      'import { visibleWidth } from "@earendil-works/pi-tui";',
      'import type { Component } from "@earendil-works/pi-tui";',
      'import { defineTool, InteractiveMode, main as piMain, type ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      'import * as pi from "@earendil-works/pi-coding-agent";',
      'export { getMarkdownTheme } from "@earendil-works/pi-coding-agent";',
      'type Runtime = import("@earendil-works/pi-coding-agent").AgentSessionRuntime;',
      "const mode = pi.InteractiveMode;",
      "export async function draw(api: ExtensionAPI, ctx: { ui: { custom(): void } }) {",
      '  const { UserMessageComponent } = await import("@earendil-works/pi-coding-agent");',
      '  api.registerEntryRenderer("x", () => undefined);',
      '  api["registerShortcut"]("ctrl+h", { handler() {} });',
      "  ctx.ui.custom();",
      "  ctx.ui.setFooter.call(ctx.ui, undefined);",
      '  // api.registerMessageRenderer("not this one: a comment");',
      '  return "ctx.ui.onTerminalInput(not this one: a string) from @earendil-works/pi-tui";',
      "}",
      "",
    ].join("\n");
    expect(crossings("src/example.ts", text).map((crossing) => crossing.message)).toEqual([
      "src/example.ts:1 imports @earendil-works/pi-tui - the terminal's",
      "src/example.ts:2 imports @earendil-works/pi-tui - the terminal's",
      "src/example.ts:3 imports InteractiveMode from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:3 imports main from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:5 imports getMarkdownTheme from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:6 imports AgentSessionRuntime from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:7 imports InteractiveMode from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:9 imports UserMessageComponent from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:10 uses registerEntryRenderer - the terminal's view does",
      "src/example.ts:11 uses registerShortcut - the terminal's view does",
      "src/example.ts:12 uses ui.custom - the terminal's view does",
      "src/example.ts:13 uses setFooter - the terminal's view does",
    ]);
    expect(crossings("src/text-width.ts", 'export { visibleWidth } from "@earendil-works/pi-tui";\n')).toHaveLength(1);
  });

  it("finds pi's drawing parts imported, and a screen call or ui.custom read however it is reached - kept, taken out by name or through another name for the ui", () => {
    const text = [
      'import { DefaultResourceLoader, DynamicBorder, keyHint, ToolExecutionComponent, getSelectListTheme, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";',
      'import { renderDiff as diff, BorderedLoader } from "@earendil-works/pi-coding-agent";',
      "export function draw(pi: ExtensionAPI, ctx: ExtensionContext, screen: ExtensionUIContext) {",
      "  const reg = pi.registerEntryRenderer;",
      "  const { registerShortcut: key, setHeader } = pi;",
      "  const { custom } = ctx.ui;",
      "  const io = ctx.ui;",
      "  io.custom();",
      "  const { ui: { custom: open } } = ctx;",
      "  screen?.custom();",
      "  registerShortcut();",
      "  const runner = { custom: true, setFooter: () => {} };",
      "  return [reg, key, setHeader, custom, open, runner.custom, (ctx as { options: { custom: boolean } }).options.custom];",
      "}",
      "",
    ].join("\n");
    expect(crossings("src/example.ts", text).map((crossing) => crossing.message)).toEqual([
      "src/example.ts:1 imports DynamicBorder from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:1 imports keyHint from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:1 imports ToolExecutionComponent from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:1 imports getSelectListTheme from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:2 imports renderDiff from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:2 imports BorderedLoader from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:4 uses registerEntryRenderer - the terminal's view does",
      "src/example.ts:5 uses registerShortcut - the terminal's view does",
      "src/example.ts:5 uses setHeader - the terminal's view does",
      "src/example.ts:6 uses ui.custom - the terminal's view does",
      "src/example.ts:8 uses ui.custom - the terminal's view does",
      "src/example.ts:9 uses ui.custom - the terminal's view does",
      "src/example.ts:10 uses ui.custom - the terminal's view does",
      "src/example.ts:11 calls registerShortcut - the terminal's view does",
    ]);
  });

  it("finds a ui reached through a context's type by its key, pi's parts taken out of a namespace of it, and pi re-exported whole", () => {
    const text = [
      'import * as P from "@earendil-works/pi-coding-agent";',
      'export * from "@earendil-works/pi-coding-agent";',
      'export * as everything from "@earendil-works/pi-coding-agent";',
      "export { P as api };",
      'type Screen = ExtensionCommandContext["ui"];',
      'type Folder = ExtensionContext["cwd"];',
      'export async function draw(screen: ExtensionContext["ui"], other: NonNullable<ExtensionCommandContext["ui"]> | undefined, mine: Screen, ctx: ExtensionContext, cwd: Folder) {',
      "  screen.custom();",
      '  other?.["custom"]();',
      "  mine.custom();",
      '  (ctx.sessionManager as unknown as ExtensionContext["ui"]).custom();',
      "  const later: typeof ctx.ui | undefined = undefined;",
      "  later?.custom();",
      "  const { InteractiveMode: Mode, defineTool } = P;",
      "  const Q = P;",
      '  const runtime = Q["AgentSessionRuntime"];',
      '  const loaded = await import("@earendil-works/pi-coding-agent");',
      "  const { getMarkdownTheme } = loaded;",
      "  loaded.main([]);",
      "  const { custom: own } = { custom: cwd };",
      "  return [Mode, defineTool, runtime, getMarkdownTheme, own];",
      "}",
      'export const open = ({ custom }: ExtensionContext["ui"]) => custom;',
      "",
    ].join("\n");
    expect(crossings("src/example.ts", text).map((crossing) => crossing.message)).toEqual([
      "src/example.ts:2 re-exports the whole of @earendil-works/pi-coding-agent - its terminal with it",
      "src/example.ts:3 re-exports the whole of @earendil-works/pi-coding-agent as everything - its terminal with it",
      "src/example.ts:4 re-exports the whole of @earendil-works/pi-coding-agent as api - its terminal with it",
      "src/example.ts:8 uses ui.custom - the terminal's view does",
      "src/example.ts:9 uses ui.custom - the terminal's view does",
      "src/example.ts:10 uses ui.custom - the terminal's view does",
      "src/example.ts:11 uses ui.custom - the terminal's view does",
      "src/example.ts:13 uses ui.custom - the terminal's view does",
      "src/example.ts:14 imports InteractiveMode from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:16 imports AgentSessionRuntime from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:18 imports getMarkdownTheme from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:19 imports main from @earendil-works/pi-coding-agent - the terminal's",
      "src/example.ts:23 uses ui.custom - the terminal's view does",
    ]);
    // The host and all other entries are bound by the same rule.
    const whole = 'export * as pi from "@earendil-works/pi-coding-agent";\n';
    expect(crossings("src/host.ts", whole)).toHaveLength(1);
    expect(crossings("src/notice.ts", whole).map((crossing) => crossing.message)).toEqual([
      "src/notice.ts:1 re-exports the whole of @earendil-works/pi-coding-agent as pi - its terminal with it",
    ]);
    expect(crossings("src/host.ts", 'export * from "@earendil-works/pi-coding-agent";\n').map((crossing) => crossing.message)).toEqual([
      "src/host.ts:1 re-exports the whole of @earendil-works/pi-coding-agent - its terminal with it",
    ]);
  });

  it("lets a site be passed on only in its own function, from its own name", () => {
    const text = [
      "export function scopedToChat(pi: ExtensionAPI) {",
      '  pi.registerShortcut("ctrl+h", {});',
      "  return new Proxy(pi, { get: (target) => (shortcut: string, options: object) => target.registerShortcut(shortcut, options) });",
      "}",
      "export function elsewhere(target: ExtensionAPI) {",
      '  target.registerShortcut("ctrl+h", {});',
      "}",
      "",
    ].join("\n");
    const passed: string[] = [];
    expect(crossings("src/chats.ts", text, (site) => passed.push(site)).map((crossing) => crossing.message)).toEqual([
      "src/chats.ts:2 uses registerShortcut - the terminal's view does",
      "src/chats.ts:6 uses registerShortcut - the terminal's view does",
    ]);
    expect(passed).toEqual(["src/chats.ts scopedToChat: target.registerShortcut"]);
  });
});

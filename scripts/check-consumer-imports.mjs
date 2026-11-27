// Check literal imports in a consumer checkout, including relative paths that bypass package exports.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const { name, exports: entries } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const allowed = new Set(Object.keys(entries).map((key) => name + key.slice(1)));
if ([...allowed].some((key) => key.includes("*"))) throw new Error("Core entries must be named explicitly");
function check(file) {
  if (statSync(file).isDirectory()) {
    for (const entry of readdirSync(file, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || ["node_modules", "dist", "out", "build", "coverage"].includes(entry.name)) continue;
      check(join(file, entry.name));
    }
    return;
  }
  if (!/\.[cm]?[jt]sx?$/.test(file)) return;
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier :
      ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal :
      ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) ? node.arguments[0] : undefined;
    if (spec && ts.isStringLiteralLike(spec)) {
      const id = spec.text;
      const path = id.startsWith("file:") ? fileURLToPath(id) : id.startsWith(".") || isAbsolute(id) ? resolve(dirname(file), id) : undefined;
      const inside = path !== undefined ? relative(root, path) : undefined;
      const crosses = inside !== undefined && !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`);
      if (crosses || ((id === name || id.startsWith(name + "/")) && !allowed.has(id))) {
        console.error(`${file}:${source.getLineAndCharacterOfPosition(spec.getStart(source)).line + 1}: import the core through a public entry: ${id}`);
        process.exitCode = 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (process.argv.length < 3) throw new Error("Pass a consumer file or source directory to check");
for (const file of process.argv.slice(2)) check(resolve(file));

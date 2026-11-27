import { RESOURCE_MARKER } from "../plain/markdown.ts";

/**
 * Where a spec diff's lines are in the .plain files - what the ledger, a job and a host keep of a pulse's diff. The
 * panels' drawing of the diff is the terminal's.
 */

/**
 * Where the lines of a diff are in the .plain files: by a line's place in the diff, the file it is in and its
 * line there. Only lines that are in a file - added and unchanged ones; a removed line is in none now. `written`
 * is the line as the file has it - its links as written, not as the diff reads them - so a host can find it
 * again in the file's text once it is edited; absent in a ledger written before it.
 */
export type DiffWhere = Record<number, { file: string; line: number; section?: string; written?: string }>;

/** A section's header: `***functional specs***`. */
export const SECTION = /^\*\*\*[^*].*\*\*\*$/;

/** A line of a .plain file as the spec reads it: its links as the parser renders them (markdown.ts). */
function asRead(line: string): string {
  return line.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, text: string) => `\`${RESOURCE_MARKER}${text}\``);
}

/**
 * Place a spec diff's lines in the .plain files they come from - `files`, the module's and every one it
 * reads, named as they are to be shown. A spec diff is of the spec as read, the files it imports laid into
 * it, so its own line numbers are not the file's: each line is found where it is written, the file a line
 * before it was found in first, from there on, and each place once.
 */
export function locateDiffLines(diff: string, files: Array<{ name: string; text: string }>): DiffWhere {
  const where: DiffWhere = {};
  // Each line as the parser renders it: a link `[text](path)` is the span `` `[resource]text` `` in the spec as read.
  const texts = files.map((file) => {
    const written = file.text.split("\n").map((line) => line.trimEnd());
    return { name: file.name, written, lines: written.map(asRead) };
  });
  // The section each line of a file is in: the nearest `***...***` header above it, or on it.
  const sections = texts.map((file) => {
    let current: string | undefined;
    return file.lines.map((line) => (SECTION.test(line.trim()) ? (current = line.trim()) : current));
  });
  const used = new Set<string>();
  let last: { file: number; line: number } | undefined;
  // A test plain file's part of the diff is that file's alone: its `---` and its section headers are in every one of
  // them, and in the module's frontmatter - found by text anywhere, they would be placed in the wrong file.
  const testPlainFile = texts.map((file) => /^---\n(?:.*\n)*?func_id:/.test(file.written.join("\n")));
  let only: number | undefined;
  const take = (file: number, line: number, index: number) => {
    used.add(`${file}:${line}`);
    const section = sections[file]![line];
    where[index] = { file: texts[file]!.name, line: line + 1, ...(section !== undefined ? { section } : {}), written: texts[file]!.written[line]! };
    last = { file, line };
  };
  diff
    .replace(/\n+$/, "")
    .split("\n")
    .forEach((line, index) => {
      const named = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
      if (named !== null) {
        const file = texts.findIndex((candidate, at) => testPlainFile[at] === true && (candidate.name === named[1] || candidate.name.endsWith(`/${named[1]}`) || named[1]!.endsWith(`/${candidate.name}`)));
        only = file === -1 ? undefined : file;
        return;
      }
      if (line.startsWith("diff --git ")) only = undefined;
      if (DIFF_HEADER.test(line) || line.startsWith("@@") || line.startsWith("\\")) return;
      if (line.startsWith("-")) {
        // A removed line still written in a file - taken out of what is compared, not out of the spec - is that file's.
        const removed = asRead(line.slice(1).trimEnd());
        if (removed.trim() === "" || SECTION.test(removed.trim())) return;
        // In a test plain file a removed line is gone: no line of it is that line any more.
        const file = only !== undefined ? -1 : texts.findIndex((candidate) => candidate.lines.includes(removed));
        if (file !== -1) {
          const at = texts[file]!.lines.indexOf(removed);
          const section = sections[file]![at];
          where[index] = { file: texts[file]!.name, line: at + 1, ...(section !== undefined ? { section } : {}), written: texts[file]!.written[at]! };
        }
        return;
      }
      const text = (line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : line).trimEnd();
      if (text === "") {
        // A blank line: the one right after the line before it, when that is blank.
        if (last !== undefined && (only === undefined || last.file === only) && texts[last.file]!.lines[last.line + 1] === "" && !used.has(`${last.file}:${last.line + 1}`)) take(last.file, last.line + 1, index);
        return;
      }
      const order = only !== undefined ? [only] : last === undefined ? texts.map((_, file) => file) : [last.file, ...texts.map((_, file) => file).filter((file) => file !== last!.file)];
      for (const file of order) {
        const lines = texts[file]!.lines;
        const from = last !== undefined && file === last.file ? last.line + 1 : 0;
        const found = [...lines.keys()].slice(from).concat([...lines.keys()].slice(0, from)).find((at) => lines[at] === text && !used.has(`${file}:${at}`));
        if (found !== undefined) return take(file, found, index);
      }
    });
  return where;
}

/** git's own header lines of a file's part of a diff - not the spec's. */
export const DIFF_HEADER = /^(diff --git |index |--- |new file mode |deleted file mode )/;

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Each module loaded first, in a process of its own, as `turri` and a host load them - not as vitest does, which loads
 * them in its own order and hides an import cycle that leaves a constant uninitialised when another module is first.
 */
const FIRST = [
  "src/extension.ts",
  "src/session.ts",
  "src/api/session.ts",
  "src/api/plain.ts",
  "src/api/project.ts",
  "src/api/models.ts",
  "src/api/system.ts",
  "src/chats.ts",
  "src/sentinel.ts",
  "src/sentinel-chat.ts",
  "src/regenerate/confine.ts",
  "src/regenerate/records.ts",
  "src/regenerate/testing.ts",
  "src/regenerate/environment-error.ts",
];

describe("each module, loaded first in a process of its own", () => {
  it.each(FIRST)("loads %s", (file) => {
    const said = execFileSync(process.execPath, ["-e", `import("./${file}").then(() => console.log("loaded"), (error) => console.log("failed: " + error.message))`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    expect(said.trim().split("\n").at(-1)).toBe("loaded");
  });
});

/**
 * What an entry loads, in a process of its own: every package a module it reaches imports at its start. The ***plain
 * language is read with no agent runtime - an editor highlighting and checking .plain files loads no pi.
 */
describe("the packages an entry loads", () => {
  const loads = (file: string): string[] => {
    const script = `
      import { registerHooks } from "node:module";
      const packages = new Set();
      registerHooks({ resolve(specifier, context, next) {
        const resolved = next(specifier, context);
        const at = resolved.url.lastIndexOf("/node_modules/");
        if (at >= 0) { const [scope, name] = resolved.url.slice(at + 14).split("/"); packages.add(scope.startsWith("@") ? scope + "/" + name : scope); }
        return resolved;
      } });
      await import("./${file}");
      console.log(JSON.stringify([...packages].sort()));`;
    const said = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return JSON.parse(said.trim().split("\n").at(-1)!) as string[];
  };

  it("reads the ***plain language with no pi", () => {
    const packages = loads("src/api/plain.ts");
    expect(packages).toContain("js-yaml");
    expect(packages).not.toContain("@earendil-works/pi-coding-agent");
  });
});

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A home of the test's own: pi's folder - a global extension file, installed themes - is written there, never in the person's.
vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync: makeHome } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const home = makeHome(joinPath(os.tmpdir(), "turri-root-home-"));
  return { ...os, default: { ...os, homedir: () => home }, homedir: () => home };
});

const { AGENT_DIR, PACKAGE_ROOT, globalExtensionFile, setTurriRoot, themeFiles, themesInstalledGlobally, turriIdentity, turriRoot, versionLine } = await import("../src/environment.ts");
const { describeVersion, PACKAGE_NAME, turrisOnPath, versionFindings } = await import("../src/turri-versions.ts");
const { allChecks } = await import("../src/setup.ts");

/** The test's own home - checked before anything is written there, so the person's is never touched. */
function ownHome(): string {
  const home = homedir();
  if (!basename(home).startsWith("turri-root-home-") || AGENT_DIR !== join(home, ".pi", "agent")) throw new Error(`not the test's own home: ${home}`);
  return home;
}

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "turri-root-")));
});
afterEach(() => {
  setTurriRoot(PACKAGE_ROOT);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(ownHome(), ".pi"), { recursive: true, force: true });
});
afterAll(() => rmSync(ownHome(), { recursive: true, force: true }));

/** The turri CLI `version` installed by npm under the prefix `name`, its launcher beside the package: its folder for the PATH, the launcher, and the package. */
function installed(name: string, version: string): { bin: string; launcher: string; root: string } {
  const prefix = join(dir, name);
  const windows = process.platform === "win32";
  const root = windows ? join(prefix, "node_modules", "@turri-dev", "cli") : join(prefix, "lib", "node_modules", "@turri-dev", "cli");
  const bin = windows ? prefix : join(prefix, "bin");
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
  const launcher = join(bin, windows ? "turri.cmd" : "turri");
  writeFileSync(launcher, "#!/bin/sh\n");
  chmodSync(launcher, 0o755);
  return { bin, launcher, root };
}

describe("this turri - the package the person runs, not the core's own files", () => {
  it("is the core's own package until a front end says otherwise", () => {
    expect(turriRoot()).toBe(PACKAGE_ROOT);
    expect(turriIdentity().version).toBe((JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version);
  });

  it("is the package a front end sets: its version, and the version line with it", () => {
    const cli = installed("npm", "0.2.0");
    setTurriRoot(cli.root);
    expect(turriRoot()).toBe(cli.root);
    expect(turriIdentity()).toEqual({ version: "0.2.0", git_commit: null, git_dirty: null });
    expect(versionLine(undefined, "1.3.0")).toBe("turri 0.2.0 (pi 1.3.0)");
  });

  it("is the turri on the PATH that is this one - never warned about as an older turri in front of itself", () => {
    const cli = installed("npm", "0.2.0");
    setTurriRoot(cli.root);
    const alone = turrisOnPath(cli.bin);
    expect(alone.map((turri) => [turri.path, turri.version, turri.runs, turri.self])).toEqual([[cli.launcher, "0.2.0", true, true]]);
    expect(versionFindings({ onPath: alone })).toEqual([]);
    // An older turri in front of it: that one is the older, and this one - by the set package's version - the newer.
    const old = installed("node-22", "0.1.24");
    const findings = versionFindings({ onPath: turrisOnPath([old.bin, cli.bin].join(delimiter)) });
    expect(findings.map((finding) => finding.kind)).toEqual(["behind"]);
    expect(findings[0]!.text).toBe(`a bare \`turri\` runs ${old.launcher}, turri 0.1.24 - older than this turri 0.2.0`);
  });

  it("says where it is in turri --version, and marks itself among the turris on the PATH", async () => {
    const cli = installed("npm", "0.2.0");
    setTurriRoot(cli.root);
    vi.stubEnv("PATH", cli.bin);
    expect(await describeVersion(versionLine(undefined, null))).toBe(
      ["turri 0.2.0", `  this turri:      ${cli.root}`, "  newest on npm:   not known - npm did not answer", "  turri on PATH:", `    ${cli.launcher}  turri 0.2.0  (runs, this one)`].join("\n"),
    );
  });

  it("is what turri doctor checks: its version, the turri on the PATH that is it, and npm link in its own folder when none is", async () => {
    const cli = installed("npm", "0.2.0");
    mkdirSync(join(cli.root, "src"));
    setTurriRoot(cli.root);
    vi.stubEnv("PATH", join(dir, "nothing-here"));
    const unlinked = await allChecks({ cli: true, env: { PATH: "" } });
    expect(unlinked.find((check) => check.name === "turri version")).toEqual({ level: "info", name: "turri version", detail: "0.2.0 - npm did not answer, so it is not compared" });
    expect(unlinked.find((check) => check.name === "turri on PATH")).toEqual({ level: "limited", name: "turri on PATH", detail: "not found", fix: `cd ${cli.root} && npm link` });
    vi.stubEnv("PATH", cli.bin);
    const linked = await allChecks({ cli: true, env: { PATH: "" } });
    expect(linked.find((check) => check.name === "turri on PATH")).toEqual({ level: "ok", name: "turri on PATH", detail: cli.launcher });
  });

  it("is the turri a global pi extension file names, which turri doctor finds", async () => {
    const cli = installed("npm", "0.2.0");
    const extensions = join(ownHome(), ".pi", "agent", "extensions");
    mkdirSync(extensions, { recursive: true });
    writeFileSync(join(extensions, "turri.ts"), `export { default } from ${JSON.stringify(join(cli.root, "src", "extension.ts"))};\n`);
    expect(globalExtensionFile()).toBeUndefined();
    setTurriRoot(cli.root);
    expect(globalExtensionFile()).toBe(join(extensions, "turri.ts"));
    vi.stubEnv("PATH", cli.bin);
    const checks = await allChecks({ cli: true, env: { PATH: "" } });
    expect(checks.find((check) => check.name === "turri in every pi")).toMatchObject({ level: "limited", detail: `${join(extensions, "turri.ts")} loads turri into every plain pi too` });
  });

  it("has its themes in its own folder, installed globally once pi's folder has each of them", () => {
    const cli = installed("npm", "0.2.0");
    mkdirSync(join(cli.root, ".pi", "themes"), { recursive: true });
    writeFileSync(join(cli.root, ".pi", "themes", "turri-dark.json"), "{}\n");
    setTurriRoot(cli.root);
    expect(themeFiles()).toEqual(["turri-dark.json"]);
    expect(themesInstalledGlobally()).toBe(false);
    mkdirSync(join(ownHome(), ".pi", "agent", "themes"), { recursive: true });
    writeFileSync(join(ownHome(), ".pi", "agent", "themes", "turri-dark.json"), "{}\n");
    expect(themesInstalledGlobally()).toBe(true);
  });
});

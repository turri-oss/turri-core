// Install exactly what would be published. No ancestor node_modules or source aliases to hide a missing file/type/peer.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "turri-consumer-"));
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const npm = (args, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: "utf8" });
try {
  // A linked consumer must be able to load each named entry using Node's own type stripping.
  const entries = Object.entries(manifest.exports).filter(([, target]) => typeof target !== "string");
  const sources = entries.map(([key, target]) => [manifest.name + key.slice(1), target["turri-source"]]);
  execFileSync(process.execPath, ["--conditions=turri-source", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    for (const [id, source] of ${JSON.stringify(sources)}) {
      assert.equal(import.meta.resolve(id), new URL(source, import.meta.url).href);
      await import(id);
    }`], { cwd: root, stdio: "inherit" });
  const [pack] = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", dir], root));
  const files = new Set(pack.files.map(({ path }) => path));
  for (const target of Object.values(manifest.exports)) {
    if (typeof target === "string") continue;
    for (const key of ["types", "import"]) if (!files.has(target[key].slice(2))) throw new Error(`Missing from tarball: ${target[key]}`);
  }
  const consumer = { name: "consumer", private: true, type: "module", dependencies: {
    [manifest.name]: `file:./${pack.filename}`, ...manifest.peerDependencies, "@types/node": manifest.devDependencies["@types/node"],
  } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(consumer));
  // Keep CI's tested resolutions when installing the tarball instead of independently floating every SDK dependency.
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  lock.name = consumer.name;
  lock.packages[""] = consumer;
  lock.packages[`node_modules/${manifest.name}`] = { version: manifest.version, resolved: consumer.dependencies[manifest.name], integrity: pack.integrity, dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies };
  lock.packages = consumerTree(lock.packages);
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
  npm(["ci", "--prefer-offline", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  copyFileSync("tests/contracts/consumer.mts", join(dir, "consumer.mts"));
  copyFileSync("tests/contracts/private-import.mts", join(dir, "private-import.mts"));
  const node = (args, env = process.env) => execFileSync(process.execPath, args, { cwd: dir, env, stdio: "inherit" });
  node([resolve("node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2023", "consumer.mts", "private-import.mts"]);
  node(["private-import.mts"]);
  const home = join(dir, "home");
  mkdirSync(home);
  node(["consumer.mts"], { ...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: join(home, "agent"), TURRI_UPDATE_CHECK: "off", TURRI_LEDGER: "on", TMPDIR: home, TEMP: home, TMP: home });
  console.log("Packed consumer: all entries, declarations, shared pi and private-import boundary passed.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The lock's entries the consumer reaches, with the flags it gives them. The repository's lock marks pi and @types/node
// dev, as they are here; npm 11 works the consumer's flags out again, but npm 10 - Node 22.19's - trusts them and
// leaves both out under --omit=dev. So nothing is kept dev, and what only the repository's development reaches is
// dropped, lest it hide a dependency the package forgot. A dependency resolves as Node finds it: in the dependent's own
// node_modules, then in each one above it. One reached only through optional dependencies stays optional, so a
// platform's own build is skipped elsewhere.
function consumerTree(packages) {
  const kept = {};
  const resolveFrom = (path, name) => {
    for (let dir = path; ; dir = dir.slice(0, Math.max(0, dir.lastIndexOf("/node_modules/")))) {
      const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
      if (packages[candidate]) return candidate;
      if (!dir) return undefined;
    }
  };
  const visit = (path, optional) => {
    const seen = kept[path];
    if (seen && (!seen.optional || optional)) return;
    const { dev, devOptional, optional: wasOptional, peer, ...entry } = packages[path];
    kept[path] = optional ? { ...entry, optional: true } : entry;
    const optionals = Object.keys(entry.optionalDependencies ?? {});
    const required = [
      ...Object.keys(entry.dependencies ?? {}).filter((name) => !optionals.includes(name)),
      ...Object.keys(entry.peerDependencies ?? {}).filter((name) => !entry.peerDependenciesMeta?.[name]?.optional),
    ];
    for (const [name, isOptional] of [...required.map((name) => [name, optional]), ...optionals.map((name) => [name, true])]) {
      const found = resolveFrom(path, name);
      if (found) visit(found, isOptional);
      else if (!isOptional) throw new Error(`package-lock.json has no ${name} for ${path || "the consumer"}`);
    }
  };
  visit("", false);
  return kept;
}

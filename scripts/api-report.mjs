// One declaration report per public import, including types reached through its signatures.
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const updating = process.argv.includes("--update");
if (updating) mkdirSync("api", { recursive: true });
const targets = Object.entries(manifest.exports).filter(([entry]) => entry !== "./package.json");
const reportName = (entry) => entry === "." ? "session" : entry.slice(2);
// Extractor compares one entry at a time. Retiring an entire subpath must change its report too.
const expected = new Set(targets.map(([entry]) => `${reportName(entry)}.api.md`));
for (const name of readdirSync("api")) {
  if (name.endsWith(".api.md") && !expected.has(name)) throw new Error(`api/${name} no longer has a public entry. Remove its report along with the export.`);
}
for (const [entry, target] of targets) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: process.cwd(), mainEntryPointFilePath: resolve(target.types),
      compiler: { tsconfigFilePath: "<projectFolder>/tsconfig.build.json" },
      newlineKind: "lf",
      apiReport: { enabled: true, includeForgottenExports: true, reportFileName: reportName(entry), reportFolder: "<projectFolder>/api", reportTempFolder: "<projectFolder>/.scratch/api-review" },
      docModel: { enabled: false }, dtsRollup: { enabled: false }, tsdocMetadata: { enabled: false },
      messages: {
        // The report includes referenced local types regardless of whether they have their own export.
        extractorMessageReporting: { "ae-missing-release-tag": { logLevel: "none" }, "ae-forgotten-export": { logLevel: "none" } },
        tsdocMessageReporting: { default: { logLevel: "none" } },
      },
    },
    configObjectFullPath: undefined, packageJsonFullPath: resolve("package.json"),
  });
  const result = Extractor.invoke(config, { localBuild: updating });
  if (!result.succeeded) process.exitCode = 1;
}

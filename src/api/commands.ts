import { resolve } from "node:path";
import { configForSpec, modelSpec, projectModels } from "../config.ts";
import { createLaunchTrack } from "../launch-track.ts";
import { runLaunchAgent } from "../launch-agent.ts";
import { createJobRegistry } from "../regenerate/jobs.ts";
import { createWorkLoop } from "../regenerate/loop.ts";
import { refuseTestPlainFile } from "../test-plain-files.ts";
import { lookAhead } from "../preview.ts";
import { runHeadless as run, type HeadlessOptions, type HeadlessView } from "../headless.ts";

export { moduleStates, type HeadlessView, type HeadlessEnd, type HeadlessResult } from "../headless.ts";
export { describeDrift, describeModules } from "../regenerate/loop.ts";
export { allChecks, asksModels, MARK, verdictOf } from "../setup.ts";
export { runCapture, CaptureError, DEFAULT_PARALLEL, type CaptureOptions, type CaptureResult } from "../capture/capture.ts";
export { runSkill, describeGates } from "../genome.ts";
export { discoverSkills } from "../skills.ts";
export { loadSkill } from "../skill.ts";
export { runAsk } from "../ask.ts";
export type { Decision, Reporter } from "../graph.ts";
export { skillRunDir, defaultBuildDir } from "../regenerate/paths.ts";
export { historyLog, historyShow } from "../regenerate/lineage.ts";
export { PACKAGE_ROOT, setTurriRoot, turriRoot, versionLine, themeFiles, extensionInstalledGlobally, themesInstalledGlobally } from "../environment.ts";
export { describeVersion } from "../turri-versions.ts";
export { applyBedrockRegion } from "../bedrock-region.ts";
export { bedrockMakerOf, bedrockRegionOf, vendorOf, priced, type Asked, type Paint } from "../init-config.ts";
export { globalExtensionFile } from "../environment.ts";
export { dropNoise } from "../quiet.ts";
export { followLaunchedLogs, runningLaunched, stopLaunched } from "../regenerate/launch.ts";

export type HeadlessRun = HeadlessOptions & (
  | { work: "preview" }
  | { work: "regenerate"; again?: string[] }
  | { work: "fromScratch"; chain?: boolean }
  | { work: "conform"; funcIds?: string[]; separately?: boolean; fromScratch?: "module" | "chain" }
);

/** Give the CLI's request to the loop. A preview can never take a path that starts a pulse. */
export function runHeadless(request: HeadlessRun, view: HeadlessView) {
  const file = resolve(request.plainFile);
  return run({ ...request, plainFile: file, dryRun: request.work === "preview", ask: (loop) => {
    switch (request.work) {
      case "preview": return lookAhead(loop, file);
      case "regenerate": return request.again?.length ? loop.regenerateAgain(file, request.again) : loop.bringUp(file);
      case "fromScratch": return loop.fromScratch(file, { chain: request.chain });
      case "conform": return loop.conformance(file, { funcIds: request.funcIds, separately: request.separately, fromScratch: request.fromScratch });
    }
  } }, view);
}

/** `turri drift` without a session, a model or any work started. */
export function readDrift(plainFile: string, cwd = process.cwd()) {
  const file = resolve(cwd, plainFile);
  refuseTestPlainFile(file);
  return createWorkLoop({ registry: createJobRegistry(), cwd, planner: false }).drift(file);
}

/** A standalone CLI launch. Its view owns the console, signals and how long to follow the logs. */
export async function launchModule(plainFile: string, options: { cwd?: string; inModule?: string; guidance?: string; model?: string; onDelta?: (delta: string) => void } = {}) {
  const cwd = options.cwd ?? process.cwd();
  const file = resolve(cwd, plainFile);
  refuseTestPlainFile(file);
  const model = options.model ?? modelSpec(projectModels(configForSpec(file)).coding);
  const track = createLaunchTrack({ cwd, run: (launch, code, signal, freed) => runLaunchAgent({ cwd, launch, code, signal, freed, model, onDelta: options.onDelta }) });
  const { launch } = track.request({ plainFile: file, inModule: options.inModule, guidance: options.guidance, cause: {} });
  return track.done(launch.id);
}

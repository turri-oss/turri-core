import { resolve } from "node:path";
import { configForSpec, modelSpec, projectModels } from "./config.ts";
import { createLaunchTrack } from "./launch-track.ts";
import { runLaunchAgent } from "./launch-agent.ts";
import { createJobRegistry } from "./regenerate/jobs.ts";
import { createWorkLoop, type DriftReport } from "./regenerate/loop.ts";
import { refuseTestPlainFile } from "./test-plain-files.ts";
import { applyBedrockRegion } from "./bedrock-region.ts";
import { projectDirOf } from "./regenerate/paths.ts";
import type { Launch } from "./launch-track.ts";

/**
 * What can be asked of a project on disk with no session open: how far its code has drifted from its spec, and a launch
 * of its code on its own - the unattended `turri drift` and `turri launch`.
 */

/** What is left to regenerate in each codebase of the module's chain - planning nothing, starting nothing, calling no model. */
export function readDrift(plainFile: string, cwd = process.cwd()): DriftReport[] {
  const file = resolve(cwd, plainFile);
  refuseTestPlainFile(file);
  return createWorkLoop({ registry: createJobRegistry(), cwd, planner: false }).drift(file);
}

/**
 * Launch a module's code on its own, outside any session: the launch agent, on the codebase's coding model unless one is
 * named, follows the project's guidance - its words as they stream to `onOutput`. Resolves when the launch ends.
 */
export async function launchModule(plainFile: string, options: { cwd?: string; inModule?: string; guidance?: string; model?: string; onOutput?: (text: string) => void } = {}): Promise<Launch> {
  const cwd = options.cwd ?? process.cwd();
  const file = resolve(cwd, plainFile);
  refuseTestPlainFile(file);
  const model = options.model ?? modelSpec(projectModels(configForSpec(file)).coding);
  // The AWS region its Bedrock model needs, set as a session sets it as it opens: this launch has none open.
  applyBedrockRegion(projectDirOf(file), model !== undefined ? { also: [model] } : {});
  const track = createLaunchTrack({ cwd, run: (launch, code, signal, freed) => runLaunchAgent({ cwd, launch, code, signal, freed, model, ...(options.onOutput !== undefined ? { onDelta: options.onOutput } : {}) }) });
  const { launch } = track.request({ plainFile: file, ...(options.inModule !== undefined ? { inModule: options.inModule } : {}), ...(options.guidance !== undefined ? { guidance: options.guidance } : {}), cause: {} });
  return track.done(launch.id);
}

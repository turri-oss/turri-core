import { sweepOrphanedGroups } from "./regenerate/shell.ts";
import { refuseTestPlainFile } from "./test-plain-files.ts";
import { relative, resolve, sep } from "node:path";
import {
  brokenConfig,
  configForSpec,
  inheritModel,
  modelOnly,
  modelSpec,
  projectModels,
  readProjectConfig,
  roleModel,
  ROLE_THINKING,
  splitModelSpec,
  type ProjectConfig,
} from "./config.ts";
import { PACKAGE_ROOT } from "./environment.ts";
import { describeTurnIncident, onModelEvent, type ModelEvent } from "./regenerate/activity.ts";
import { ledgerWanted, startLedger } from "./regenerate/ledger.ts";
import { describeDiagnosis, diagnoseFailure } from "./regenerate/diagnose.ts";
import { createJobRegistry, type Job } from "./regenerate/jobs.ts";
import { createWorkLoop, functionalityCompletion, type DriftReport, type ModuleStatus, type PlannedPulse, type WorkLoop } from "./regenerate/loop.ts";
import { MODULES_DIR, projectDirOf } from "./regenerate/paths.ts";
import { exportModule } from "./regenerate/launch.ts";
import { listFiles } from "./regenerate/testing.ts";
import { startRunReport, type ModuleState, type RunReporter } from "./run-report.ts";

/**
 * A headless run: what every command that builds - `turri regenerate`, `conform` - does around its own request of the
 * work loop, as the chat does it: the project's models, a job that fails run once more and, failing again, diagnosed;
 * then the loop run until nothing more can start, and how it ended. With `dryRun`, `ask` is a look ahead
 * (`WorkLoop.lookAhead`): the work is planned, the next pulse of each codebase told from the plan kept, and nothing runs.
 *
 * It prints nothing, asks nothing and never exits the process: what a person is shown and asked goes through the
 * HeadlessView, and how the run ended - with the exit code the command ends with - is returned. A run refused before it
 * starts - a test plain file, a config that does not parse, a --build-dir the export would wipe something in - throws.
 */
export interface HeadlessRun {
  plainFile: string;
  /** Where the code is exported to as the run ends, however it ends: the furthest-built codebase's last commit. */
  buildDir?: string;
  /** The run report's file (`--report`): see run-report.ts. */
  report?: string;
  /** The command, as the report gives it: its name and its arguments. */
  command?: string[];
  /** Plan and tell the next pulses, starting nothing - `ask` a look ahead. */
  dryRun?: boolean;
  /** Start over, unasked, a codebase that has to be on a module it now requires (`--start-over`). */
  startOver?: boolean;
  /** The request: bring up, regenerate, conformance. */
  ask: (loop: WorkLoop) => Promise<ModuleStatus[]>;
}

/**
 * What a headless run shows and asks, each at the point it happens - the command line's console, a test's record. A
 * run calls nothing else of the person.
 */
export interface HeadlessView {
  /** Before anything starts: the process groups a turri that was killed left running, stopped - only when there were any. */
  orphansStopped(count: number): void;
  /** What the ledger could not write. */
  warn(message: string): void;
  /** As the process exits, however it exits: the code exported into the --build-dir - or why nothing was (`exportCode`). */
  exported(exported: Record<string, unknown>, buildDir: string): void;
  /** A pulse running: as it starts, and again at each new stage. */
  pulseRunning(job: Job): void;
  /**
   * A pulse ended, however it ended - before the run report is written again. Nobody is asked here: the spec gaps its
   * agents met are in its details (`specGaps`).
   */
  pulseFinished(job: Job): void;
  /** A provider failing and waited out, a turn turri ended itself - and its line (`describeTurnIncident`). */
  turnIncident(event: ModelEvent, line: string): void;
  /** What the request planned in each codebase - and again after a start over. */
  planned(statuses: ModuleStatus[]): void;
  /** Whether there is someone to ask - a terminal. */
  canAsk(): boolean;
  /** Yes or no, put to the person: whether to start over - true for yes. Undefined when there is no one to ask after all. */
  ask(title: string, body: string): Promise<boolean | undefined>;
  /** The run stops at a codebase it would have to start over, with no one to ask and no `startOver`: why, and what to do. */
  startOverRefused(message: string): void;
  /** A dry run: the next pulse of a codebase, from the plan the look ahead kept - the one regenerate would start. */
  nextPulse(pulse: PlannedPulse): void;
  /** Nothing more can start: how each codebase stands. */
  drained(statuses: ModuleStatus[]): void;
  /** How the run ended: every job, those that failed, and the codebases not complete. */
  ended(end: HeadlessEnd): void;
}

/** What a headless run's verdict is made of. */
export interface HeadlessEnd {
  /** The spec the run was for, resolved. */
  plainFile: string;
  /** Every job of the run, in the order they were queued. */
  jobs: Job[];
  failed: Job[];
  /** The codebases not regenerated from the spec as it is, its conformance tests too. */
  unfinished: ModuleState[];
}

/** How a headless run ended, and the exit code the command ends with: 0 only for a dry run, or nothing failed and every codebase complete. */
export interface HeadlessResult {
  status: "completed" | "incomplete" | "failed" | "dry_run";
  exitCode: 0 | 1;
}

/** Run it, the view shown and asked what a person would be: see HeadlessRun. `turri regenerate` and `conform` exit with its exitCode. */
export async function runHeadless(options: HeadlessRun, view: HeadlessView): Promise<HeadlessResult> {
  const plainFile = resolve(options.plainFile);
  refuseTestPlainFile(plainFile);
  // A config that does not parse is read as empty: refused, rather than every pulse run on defaults - pi's model among them.
  const broken = brokenConfig(projectDirOf(plainFile));
  if (broken !== undefined) throw new Error(`Nothing was started: ${broken}`);
  // What a turri that was killed left running - commands' process groups - stopped before anything starts.
  const orphans = sweepOrphanedGroups();
  if (orphans > 0) view.orphansStopped(orphans);
  const project = { ...readProjectConfig(process.cwd()), ...Object.fromEntries(Object.entries(configForSpec(plainFile)).filter(([, value]) => value !== undefined)) };
  // The models as the config has them - with a command's own options read as its keys (headlessOptions), as the chat reads them.
  const model = modelSpec(projectModels(project).coding);
  const projectDir = projectDirOf(plainFile);
  // What the run does, as facts, in the project's .turri/ledger.
  if (ledgerWanted() && options.dryRun !== true) startLedger({ mode: options.command?.[0] ?? "headless", project: projectDir, warn: (message) => view.warn(message) });
  const buildDir = options.buildDir !== undefined && options.dryRun !== true ? resolve(options.buildDir) : undefined;
  if (buildDir !== undefined) {
    const problem = buildDirProblem(buildDir, projectDir);
    if (problem !== undefined) throw new Error(problem);
  }

  // The code, exported into --build-dir as the process exits - however it exits - before the report's last write.
  let exported: Record<string, unknown> | undefined;
  if (buildDir !== undefined) {
    process.once("exit", () => {
      exported = exportCode(plainFile, buildDir);
      view.exported(exported, buildDir);
    });
  }
  const report =
    options.report !== undefined && options.dryRun !== true
      ? startRunReport({
          file: options.report,
          command: options.command ?? process.argv.slice(2),
          specFile: plainFile,
          projectDir,
          ...(buildDir !== undefined ? { buildDir } : {}),
          review: project.review === true,
          mutationTesting: project.mutationTesting !== false,
          models: reportModels(project, model),
        })
      : undefined;
  try {
    return await runLoopReporting({ ...options, plainFile, project, model, projectDir, reporter: report, exported: () => exported }, view);
  } catch (error) {
    report?.crashed(error);
    throw error;
  }
}

async function runLoopReporting(
  options: HeadlessRun & {
    project: ProjectConfig;
    model: string | undefined;
    projectDir: string;
    reporter: RunReporter | undefined;
    exported: () => Record<string, unknown> | undefined;
  },
  view: HeadlessView,
): Promise<HeadlessResult> {
  const { plainFile, project, model, projectDir, reporter: report } = options;

  // Each job as it starts and as it ends - the transcript of each is in .turri/jobs/.
  const seen = new Map<string, string>();
  const registry = createJobRegistry({
    retries: 1,
    diagnose: async (job, failures, jobLog) => {
      const diagnosis = await diagnoseFailure({ job, failures, projectDir, harnessDir: PACKAGE_ROOT, jobLog, model: modelSpec(modelOnly(job.model ?? model)) });
      return diagnosis !== undefined ? describeDiagnosis(diagnosis) : undefined;
    },
    onChange: (job: Job) => {
      const line = job.status === "running" ? `${job.stage ?? "started"}` : job.status;
      if (seen.get(job.id) === line) return;
      seen.set(job.id, line);
      if (job.status === "running") view.pulseRunning(job);
    },
    onFinish: (job: Job) => {
      view.pulseFinished(job);
      report?.write();
    },
  });
  // A provider failing and waited out, a turn turri ended itself: said as they happen, not left in the job logs alone.
  onModelEvent((event) => {
    const line = describeTurnIncident(event);
    if (line !== undefined) view.turnIncident(event, line);
  });
  const planner = modelSpec(projectModels(project).harness);
  const loop = createWorkLoop({
    registry,
    cwd: process.cwd(),
    ...(model !== undefined ? { modelFor: () => model } : {}),
    ...(planner !== undefined ? { plannerModel: planner } : {}),
  });
  report?.attach({
    jobs: () => registry.list(),
    modules: () => moduleStates(loop.drift(plainFile)),
    completion: () => functionalityCompletion(plainFile),
    atExit: () => {
      const exported = options.exported();
      return exported !== undefined ? { build_dir_export: exported } : undefined;
    },
  });
  let planned = await options.ask(loop);
  view.planned(planned);

  // A codebase built without a module it now requires is started over only when the person says so.
  const toStartOver = planned.filter((status) => status.startOver !== undefined);
  if (toStartOver.length > 0 && options.dryRun !== true) {
    const why = toStartOver
      .map(({ startOver }) =>
        startOver!.old === true
          ? `${startOver!.codebases.join(", ")} was built when functional specs were numbered, before they had func-ids: nothing more can be built on it.`
          : `${startOver!.codebases.join(", ")} was built without ${startOver!.requires.join(", ")}, which it now requires: no change to its code can bring it in.`,
      )
      .join("\n");
    // No terminal and no --start-over: no one to ask, so the run stops here rather than build nothing and say it is done.
    if (options.startOver !== true && view.canAsk() !== true) {
      const message = `${why}\nThere is no terminal to ask whether to start over: run it again with --start-over to start over without asking.`;
      view.startOverRefused(message);
      report?.end("incomplete", message);
      return { status: "incomplete", exitCode: 1 };
    }
    const agreed =
      options.startOver === true ||
      (await view.ask(
        "Start over?",
        `${why}\nStarting over takes its code and conformance tests out - they stay in its history - and builds it again from the bottom of the chain.`,
      ));
    if (agreed === true) {
      planned = await loop.startOver(plainFile, model !== undefined ? { model } : {});
      view.planned(planned);
    }
  }

  if (options.dryRun === true) {
    // The next pulse of each codebase, from the plan the look ahead kept - the one regenerate would start.
    for (const status of planned) {
      const first = status.planned[0];
      if (first === undefined || first.afterCode === true || first.planning === true) continue;
      const next = await loop.plannedPulse(`planned-${status.module}-1`);
      if (next === undefined) continue;
      view.nextPulse(next);
    }
    return { status: "dry_run", exitCode: 0 };
  }

  // Until nothing more starts: a choice is made inside the pulse it follows, so draining waits for it.
  await loop.drain();
  view.drained(loop.status());
  const ended = registry.list();
  const failed = ended.filter((job) => job.status === "failed");
  // Complete: every codebase regenerated from the spec as it is, its conformance tests too - nothing halted, nothing
  // waiting for a start over, nothing the planner left out.
  const unfinished = moduleStates(loop.drift(plainFile)).filter((module) => module.state !== "complete");
  view.ended({ plainFile, jobs: ended, failed, unfinished });
  report?.end(failed.length > 0 ? "failed" : unfinished.length > 0 ? "incomplete" : "completed");
  return failed.length === 0 && unfinished.length === 0 ? { status: "completed", exitCode: 0 } : { status: failed.length > 0 ? "failed" : "incomplete", exitCode: 1 };
}

/** How each codebase stands, from what is left to regenerate there. */
export function moduleStates(reports: DriftReport[]): ModuleState[] {
  return reports.map((report): ModuleState => {
    const state: ModuleState["state"] =
      report.running !== undefined
        ? "running"
        : report.startOver !== undefined
          ? "start_over_needed"
          : report.why !== undefined
            ? "halted"
            : report.code === null && (report.conformance === null || report.conformance === undefined)
              ? "complete"
              : "incomplete";
    const why =
      state === "start_over_needed"
        ? report.startOver!.old === true
          ? "built when functional specs were numbered, before they had func-ids: run with --start-over to regenerate its chain from scratch"
          : `built without ${report.startOver!.requires.join(", ")}, which it now requires: run with --start-over`
        : state === "incomplete"
          ? report.code !== null && report.code !== undefined
            ? "its code is not regenerated from the spec as it is"
            : "its conformance tests are not written for what is built"
          : report.why;
    return { module: report.module, state, ...(why !== undefined ? { why } : {}) };
  });
}

/**
 * Why a --build-dir cannot be used - one the export would wipe something in: the project, a folder holding it, or one
 * inside plain_modules - or undefined when it can. Anything else is the export's own, its contents replaced as the run ends.
 */
export function buildDirProblem(buildDir: string, projectDir: string): string | undefined {
  const within = (dir: string, of: string) => dir === of || dir.startsWith(`${of}${sep}`);
  const why = within(projectDir, buildDir)
    ? "it holds the project, and the export replaces what is in it"
    : within(buildDir, resolve(projectDir, MODULES_DIR))
      ? `it is inside ${MODULES_DIR}, which turri regenerates in`
      : undefined;
  if (why === undefined) return undefined;
  return `--build-dir ${buildDir} cannot be used: ${why}. Name a folder of its own - the code is exported there as the run ends.`;
}

/** The furthest-built codebase's last commit, exported into `dir` - or why nothing was. */
export function exportCode(plainFile: string, dir: string): Record<string, unknown> {
  try {
    const code = exportModule(plainFile, { into: dir });
    const files = listFiles(dir).length;
    // Its history began, and nothing landed in it yet: only the harness's own files, which are left out.
    if (files === 0) return { exported: false, dir, why: `nothing has landed in ${code.moduleName} yet: its codebase holds no code` };
    return { exported: true, dir, module: code.moduleName, commit: code.short, files };
  } catch (error) {
    return { exported: false, dir, why: error instanceof Error ? error.message : String(error) };
  }
}

/** The models of the three roles as this run uses them: the coding model given, the others as they fall back - each with the level it thinks at. */
export function reportModels(project: ProjectConfig, model: string | undefined): Record<"harness" | "coding" | "judge", { model?: string; thinking?: string }> {
  const coding = splitModelSpec(model);
  const harness = projectModels(project).harness ?? modelOnly(model);
  // As the judge's agent finds it: its models: entry over judge-model over models.default, else the coding model's.
  const judge = inheritModel(roleModel(project, "judge"), modelOnly(model)) ?? {};
  const choice = (given: { model?: string; thinking?: string }, fallback: string | undefined) => ({
    ...(given.model !== undefined ? { model: given.model } : {}),
    ...((given.thinking ?? fallback) !== undefined ? { thinking: given.thinking ?? fallback } : {}),
  });
  return {
    harness: choice(harness, ROLE_THINKING.planner),
    coding: choice(coding, ROLE_THINKING.coding),
    judge: choice(judge, ROLE_THINKING.judge),
  };
}

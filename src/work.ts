import { resolve, sep } from "node:path";
import { brokenConfig, inheritModel, modelOnly, modelSpec, projectModels, readProjectConfig, roleModel, ROLE_THINKING, splitModelSpec, type ProjectConfig } from "./config.ts";
import { checkModule } from "./module-check.ts";
import { formatCheckResults } from "./plain/check.ts";
import { CONFORMANCE_OFF_REFUSAL, conformanceTestsOn } from "./conformance-switch.ts";
import { refuseTestPlainFile } from "./test-plain-files.ts";
import { stopJob, whenBuildable } from "./loop-tools.ts";
import { functionalityCompletion, type DriftReport, type ModuleStatus, type WorkLoop } from "./regenerate/loop.ts";
import type { Job, JobRegistry } from "./regenerate/jobs.ts";
import { MODULES_DIR, projectDirOf } from "./regenerate/paths.ts";
import { exportModule } from "./regenerate/launch.ts";
import { listFiles } from "./regenerate/testing.ts";
import { startRunReport, type ModuleState } from "./run-report.ts";
import { isTurriError, TurriError } from "./errors.ts";

/**
 * Work asked of the session's work loop - regenerating a module, or writing its conformance tests - as the chat's
 * regenerate and conform tools ask it and as a front end or an unattended run does: one path, so the two never differ.
 */

export type WorkKind = "regenerate" | "conform";

/** What is asked of the loop. */
export interface WorkRequest {
  /** The module's .plain file, absolute or from the session's folder. */
  plainFile: string;
  /**
   * regenerate: functional specs already built, each `module:func-id`, regenerated though their spec did not change.
   * conform: the functional specs to test (each with scenarios); one whose tests are written has them written again.
   */
  funcIds?: string[];
  /** Only when the person asks: the module's code - or tests, for conform - taken out and built again; `chain`, its whole requires chain. */
  fromScratch?: "module" | "chain";
  /** conform: a pulse a functional spec instead of one for all. */
  separately?: boolean;
  /** The coding model for this work alone, provider/model-id with an optional thinking level. Default: the module's. */
  model?: string;
}

/**
 * The work asked of the loop - the one call the chat's regenerate and conform tools and the session's `work` make, after
 * their checks. Returns what each codebase of the module's chain was planned to.
 */
export async function planWork(loop: WorkLoop, kind: WorkKind, request: WorkRequest): Promise<ModuleStatus[]> {
  const plainFile = resolve(request.plainFile);
  const model = request.model !== undefined ? { model: request.model } : {};
  if (kind === "conform") {
    return loop.conformance(plainFile, {
      ...(request.funcIds !== undefined ? { funcIds: request.funcIds } : {}),
      ...model,
      ...(request.separately === true ? { separately: true } : {}),
      ...(request.fromScratch !== undefined ? { fromScratch: request.fromScratch } : {}),
    });
  }
  if (request.fromScratch !== undefined) return loop.fromScratch(plainFile, { ...model, chain: request.fromScratch === "chain" });
  if ((request.funcIds ?? []).length > 0) return loop.regenerateAgain(plainFile, request.funcIds!, model);
  return loop.bringUp(plainFile, model);
}

/**
 * The work asked of the loop after the checks the chat's tools make, each refusal a TurriError: a test plain file, a
 * module that would be built with a config naming no unit testing script, one that does not parse, funcIds with
 * fromScratch, conformance tests turned off.
 */
export async function askLoop(loop: WorkLoop, kind: WorkKind, request: WorkRequest): Promise<ModuleStatus[]> {
  const plainFile = resolve(request.plainFile);
  try {
    refuseTestPlainFile(plainFile);
    whenBuildable(plainFile, () => undefined);
    if (kind === "conform") {
      if (!conformanceTestsOn(plainFile)) throw new TurriError("refused", CONFORMANCE_OFF_REFUSAL);
    } else {
      const check = checkModule(plainFile);
      // The parser's message as it gives it, a test plain file out of place, and turri's next step for the old syntax.
      if (!check.ok) throw new TurriError("refused", `${plainFile} does not parse, so nothing can be regenerated from it yet:\n${formatCheckResults([check])}`);
      if ((request.funcIds ?? []).length > 0 && request.fromScratch !== undefined) throw new TurriError("refused", "Name funcIds or set fromScratch, not both: from scratch regenerates every one of them.");
    }
  } catch (error) {
    throw isTurriError(error) ? error : new TurriError("refused", error instanceof Error ? error.message : String(error), { cause: error });
  }
  return planWork(loop, kind, { ...request, plainFile });
}

/** A start over put to whoever answers it for a run: what would be started over, and why, in turri's words. */
export interface StartOverQuestion {
  /** The question, a few words: "Start over?" */
  title: string;
  /** Why each codebase cannot be brought up by changing its code, and what starting over does. */
  body: string;
  /** The codebases that would be started over. */
  codebases: string[];
}

/** How a run of work goes on past what it planned. */
export interface WorkRunOptions {
  /**
   * A codebase built without a module it now requires - or before functional specs had func-ids - cannot be brought up
   * by changing its code: it is started over only when this says so. The answer: `true`, started over; `false`, not -
   * the rest of the chain is regenerated, and the run ends incomplete with those codebases unfinished; `"ask"`, the
   * person is asked through the front end; a function, it is asked, for this run alone, and answers `true`, `false`, or
   * undefined for no answer. Absent, or no answer: the run ends incomplete at once, saying why.
   */
  startOver?: boolean | "ask" | ((question: StartOverQuestion) => Promise<boolean | undefined>);
  /** A run report written to this file as the run goes (run-report.ts). */
  report?: string;
  /** The command, as the report gives it. */
  command?: string[];
  /** The furthest-built codebase's last commit exported into this folder as the run ends, however it ends. */
  exportTo?: string;
  /** Aborted: the run's modules halted - running pulses stopped, nothing more started - and `done` resolves `stopped`. */
  signal?: AbortSignal;
}

/** What the session gives a run. */
export interface WorkContext {
  loop: WorkLoop;
  jobs: JobRegistry;
  /** Each job's end, as the registry tells it. Returns what stops hearing. */
  onFinish(listener: (job: Job) => void): () => void;
  /** A yes or no put to the person; undefined when nobody can answer. */
  ask?(title: string, body: string): Promise<boolean | undefined>;
}

/** A run of work started: what it planned, and how it ends. */
export interface WorkRun {
  /** What each codebase of the module's chain was planned to - again after a start over. */
  planned: ModuleStatus[];
  /** Resolves when nothing more can start: the verdict. Never rejects. */
  done: Promise<WorkResult>;
}

/** How a run of work ended. */
export interface WorkResult {
  /** `completed`: nothing failed and every codebase is regenerated from the spec as it is, its conformance tests too. */
  status: "completed" | "failed" | "incomplete" | "stopped";
  plainFile: string;
  /** Every job of the session's registry, in the order they were queued. */
  jobs: Job[];
  failed: Job[];
  /** The codebases not regenerated from the spec as it is, its conformance tests too - and why. */
  unfinished: ModuleState[];
  /** Why the run ended before it was drained: a start over nobody agreed to. */
  reason?: string;
  /** With `exportTo`: what was exported, or why nothing was. */
  exported?: ExportResult;
}

export type ExportResult = { exported: true; dir: string; module: string; commit: string; files: number } | { exported: false; dir: string; why: string };

/**
 * Start a run of work: ask the loop, settle a start over, and drain - the work run until nothing more can start, the
 * verdict in `done`. What the session's chats ask meanwhile runs in the same loop and drains with it.
 */
export async function runWork(context: WorkContext, kind: WorkKind, request: WorkRequest & WorkRunOptions): Promise<WorkRun> {
  const plainFile = resolve(request.plainFile);
  const projectDir = projectDirOf(plainFile);
  // A config that does not parse is read as empty: refused, rather than every pulse run on defaults - pi's model among them.
  const broken = brokenConfig(projectDir);
  if (broken !== undefined) throw new TurriError("config-invalid", `Nothing was started: ${broken}`);
  const exportTo = request.exportTo !== undefined ? resolve(request.exportTo) : undefined;
  if (exportTo !== undefined) {
    const problem = exportDirProblem(exportTo, projectDir);
    if (problem !== undefined) throw new TurriError("refused", problem);
  }
  const { loop, jobs } = context;
  const project = readProjectConfig(projectDir);
  const report = request.report !== undefined
    ? startRunReport({
        file: request.report,
        command: request.command ?? [kind, plainFile],
        specFile: plainFile,
        projectDir,
        ...(exportTo !== undefined ? { buildDir: exportTo } : {}),
        review: project.review === true,
        mutationTesting: project.mutationTesting !== false,
        models: reportModels(project, request.model ?? modelSpec(projectModels(project).coding)),
      })
    : undefined;
  let exported: ExportResult | undefined;
  report?.attach({
    jobs: () => jobs.list(),
    modules: () => moduleStates(loop.drift(plainFile)),
    completion: () => functionalityCompletion(plainFile),
    atExit: () => (exported !== undefined ? { build_dir_export: exported } : undefined),
  });
  const stopHearing = report !== undefined ? context.onFinish(() => report.write()) : () => {};
  const finish = (result: Omit<WorkResult, "plainFile" | "exported">): WorkResult => {
    stopHearing();
    if (exportTo !== undefined) exported = exportCode(plainFile, exportTo);
    report?.end(result.status === "stopped" ? "interrupted" : result.status, result.reason);
    // Written as the run ends, not as the process does: a session outlives its runs.
    report?.write();
    return { plainFile, ...result, ...(exported !== undefined ? { exported } : {}) };
  };

  let planned: ModuleStatus[];
  try {
    planned = await askLoop(loop, kind, { ...request, plainFile });
  } catch (error) {
    stopHearing();
    report?.crashed(error);
    report?.write();
    throw error;
  }

  // A codebase built without a module it now requires is started over only when the person says so.
  const toStartOver = planned.filter((status) => status.startOver !== undefined);
  if (toStartOver.length > 0) {
    const why = toStartOver
      .map(({ startOver }) =>
        startOver!.old === true
          ? `${startOver!.codebases.join(", ")} was built when functional specs were numbered, before they had func-ids: nothing more can be built on it.`
          : `${startOver!.codebases.join(", ")} was built without ${startOver!.requires.join(", ")}, which it now requires: no change to its code can bring it in.`,
      )
      .join("\n");
    const question: StartOverQuestion = {
      title: "Start over?",
      body: `${why}\nStarting over takes its code and conformance tests out - they stay in its history - and builds it again from the bottom of the chain.`,
      codebases: [...new Set(toStartOver.flatMap(({ startOver }) => startOver!.codebases))],
    };
    const answer = request.startOver;
    const agreed =
      typeof answer === "boolean"
        ? answer
        : typeof answer === "function"
          ? await answer(question)
          : answer === "ask" && context.ask !== undefined
            ? await context.ask(question.title, question.body)
            : undefined;
    if (agreed === true) planned = await loop.startOver(plainFile, request.model !== undefined ? { model: request.model } : {});
    else if (agreed === undefined) {
      const reason = `${why}\nNobody answered whether to start over: run again with startOver true to start over, or false to regenerate the rest of the chain without it.`;
      return { planned, done: Promise.resolve(finish({ status: "incomplete", jobs: jobs.list(), failed: [], unfinished: moduleStates(loop.drift(plainFile)), reason })) };
    }
  }

  // Stopped from outside: the run's modules halted, so the drain ends with what was running rolled back.
  let stopped = false;
  const halt = () => {
    stopped = true;
    for (const status of planned) {
      try {
        stopJob(jobs, status.module, "stopped", loop);
      } catch {
        /* a module with nothing of its own to halt */
      }
    }
  };
  if (request.signal?.aborted === true) halt();
  else request.signal?.addEventListener("abort", halt, { once: true });

  const done = (async (): Promise<WorkResult> => {
    try {
      // Until nothing more starts: a choice is made inside the pulse it follows, so draining waits for it.
      await loop.drain();
    } finally {
      request.signal?.removeEventListener("abort", halt);
    }
    const ended = jobs.list();
    const failed = ended.filter((job) => job.status === "failed");
    const unfinished = moduleStates(loop.drift(plainFile)).filter((module) => module.state !== "complete");
    const status = stopped ? "stopped" : failed.length > 0 ? "failed" : unfinished.length > 0 ? "incomplete" : "completed";
    return finish({ status, jobs: ended, failed, unfinished });
  })();
  return { planned, done };
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
          ? "built when functional specs were numbered, before they had func-ids: start it over to regenerate its chain from scratch"
          : `built without ${report.startOver!.requires.join(", ")}, which it now requires: start it over`
        : state === "incomplete"
          ? report.code !== null && report.code !== undefined
            ? "its code is not regenerated from the spec as it is"
            : "its conformance tests are not written for what is built"
          : report.why;
    return { module: report.module, state, ...(why !== undefined ? { why } : {}) };
  });
}

/**
 * Why code cannot be exported into a folder - one the export would wipe something in: the project, a folder holding it,
 * or one inside plain_modules - or undefined when it can. Anything else is the export's own, its contents replaced.
 */
export function exportDirProblem(dir: string, projectDir: string): string | undefined {
  const within = (inner: string, of: string) => inner === of || inner.startsWith(`${of}${sep}`);
  const why = within(projectDir, dir)
    ? "it holds the project, and the export replaces what is in it"
    : within(dir, resolve(projectDir, MODULES_DIR))
      ? `it is inside ${MODULES_DIR}, which turri regenerates in`
      : undefined;
  if (why === undefined) return undefined;
  return `${dir} cannot be exported into: ${why}. Name a folder of its own - the code is exported there as the run ends.`;
}

/** The furthest-built codebase's last commit, exported into `dir` - or why nothing was. */
export function exportCode(plainFile: string, dir: string): ExportResult {
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

/** The models of the three roles as a run uses them: the coding model given, the others as they fall back - each with the level it thinks at. */
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

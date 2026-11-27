/**
 * `@turri-dev/core/project`: a project on disk, with no session open - its modules checked in it, its config read, its
 * settings' catalogue and edits, a project's first config (`initConfig`), how far its modules are built and what drifted, their history, the
 * ledger of what turri did, the chats of its last run, capturing an existing codebase into ***plain, and launching its
 * code on its own.
 */
import { join } from "node:path";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { projectStanding as standing, type ModuleStanding } from "../regenerate/standing.ts";

/** How far each module is built and conformed, and what drifted, read from disk - a session's `work.standing` knows its live work too. */
export function projectStanding(projectDir: string, files?: string[]): ModuleStanding[] {
  return standing(projectDir, files !== undefined ? { files } : {});
}

/** The conversations pi has saved for the project, including ones not open in a chat. */
export async function savedChatFiles(cwd: string, sessionDir?: string): Promise<string[]> {
  return (await SessionManager.list(cwd, sessionDir)).map((session) => session.path);
}

/** Where pi keeps the credentials of the providers signed in to. */
export function credentialsFile(agentDir = getAgentDir()): string {
  return join(agentDir, "auth.json");
}

export { AGENT_ROLES, CONFIG_FILE, configForSpec, configLines, configuredModel, debugMode, DEFAULT_TEST_DIR, hasProjectConfig, moduleConfigsOf, readProjectConfig, skillModel, testDirOf, type AgentRole, type ConfigLine, type ConfigLineKind, type ProjectConfig, type RoleChoice, type SentinelSetting, type ThinkingLevel } from "../config.ts";
export { configSettings, EFFECT_TEXT, overriddenBy, readConfigText, readSetting, settingTakes, type Effect, type ModelRole, type Setting, type SettingKey, type SettingKind, type SettingValues } from "../config-edit.ts";
export { initConfig, PLAIN_PAINT, type InitConfigOptions, type ModelPair, type Paint } from "../init-config.ts";
export { MODULES_DIR, projectDirOf } from "../regenerate/paths.ts";
export { defaultParallelJobs } from "../regenerate/jobs.ts";
export { describeDrift, describeModules, type DriftReport } from "../regenerate/loop.ts";
export { readDrift, launchModule } from "../project.ts";
import { historyLog as codeHistoryLog, historyShow as codeHistoryShow } from "../regenerate/lineage.ts";
import { defaultBuildDir } from "../regenerate/paths.ts";

/**
 * A module's lineage, newest first: each commit of its code and tests - when, and what it was regenerated from - one a
 * line, the last `limit` (30). `cwd`: the project's folder, the process's by default. Says so when there is none yet.
 */
export function historyLog(module: string, options: { cwd?: string; limit?: number } = {}): string {
  return codeHistoryLog(defaultBuildDir(module, options.cwd), options.limit);
}

/** One commit of a module's lineage in full: what it says, the files it changed, and how. */
export function historyShow(module: string, commit: string, options: { cwd?: string } = {}): string {
  return codeHistoryShow(defaultBuildDir(module, options.cwd), commit);
}
export { lastRun, type ChatRecord, type RunRecord } from "../chat-records.ts";
export { ledgerDir, readLedger, type AgentRef, type LedgerEntry, type LedgerEvent, type LedgerKind, type LedgerQuery } from "../regenerate/ledger.ts";
export { asJob, describePulseView, describeRuns, earlierPulses, ledgerProjects, pulseView, runViews, type PulseView, type RunView } from "../regenerate/ledger-view.ts";
export { runCapture, CaptureError, DEFAULT_PARALLEL, type CaptureOptions, type CaptureResult } from "../capture/capture.ts";
export type { Convention, Definition, Part } from "../capture/state.ts";
export type { ScriptRequest, ScriptWriter } from "../capture/scripts.ts";
export { exportCode, type ExportResult } from "../work.ts";
export { checkModule, checkModules } from "../module-check.ts";
export type { ModuleStanding } from "../regenerate/standing.ts";

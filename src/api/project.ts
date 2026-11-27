/**
 * `@turri-dev/core/project`: a project on disk, with no session open - its config read, its settings' catalogue and
 * edits, a project's first config (`initConfig`), how far its modules are built and what drifted, their history, the
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
export { configSettings, currentValue, EFFECT_TEXT, overriddenBy, readConfigText, type Effect, type Setting, type SettingKind } from "../config-edit.ts";
export { initConfig, PLAIN_PAINT, type InitConfigOptions, type ModelPair, type Paint } from "../init-config.ts";
export { MODULES_DIR, projectDirOf } from "../regenerate/paths.ts";
export { defaultParallelJobs } from "../regenerate/jobs.ts";
export { describeDrift, describeModules, type DriftReport } from "../regenerate/loop.ts";
export { readDrift, launchModule } from "../project.ts";
export { historyLog, historyShow } from "../regenerate/lineage.ts";
export { lastRun, type ChatRecord, type RunRecord } from "../chat-records.ts";
export { ledgerDir, readLedger, type AgentRef, type LedgerEntry, type LedgerEvent, type LedgerKind, type LedgerQuery } from "../regenerate/ledger.ts";
export { asJob, describePulseView, describeRuns, earlierPulses, ledgerProjects, pulseView, runViews, type PulseView, type RunView } from "../regenerate/ledger-view.ts";
export { runCapture, CaptureError, DEFAULT_PARALLEL, type CaptureOptions, type CaptureResult } from "../capture/capture.ts";
export type { Convention, Definition, Part } from "../capture/state.ts";
export type { ScriptRequest, ScriptWriter } from "../capture/scripts.ts";
export { exportCode, type ExportResult } from "../work.ts";
export type { ModuleStanding } from "../regenerate/standing.ts";

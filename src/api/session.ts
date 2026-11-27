/**
 * `@turri-dev/core`: turri's session, for any front end - its chats, work, launches, notices, sentinel, settings and
 * skills, the events it emits, and the data they carry; with turri's own words for that data, where a front end shows
 * them. Reading a project on disk without a session is `/project`; the ***plain language is `/plain`; models and
 * sign-in are `/models`; the machine is `/system`.
 */
export {
  createTurri,
  type CaptureEnd,
  type Chat,
  type ExternalSessions,
  type Frontend,
  type HaltTarget,
  type LaunchOptions,
  type ManagedSessions,
  type NoSessions,
  type Question,
  type RevealTarget,
  type SessionOverrides,
  type SessionRequest,
  type SkillGate,
  type SkillInfo,
  type SkillReport,
  type SkillResult,
  type SkillStep,
  type SkillRunOptions,
  type Turri,
  type TurriEvent,
  type TurriEventMap,
  type TurriEventType,
  type TurriOptions,
  type WorkStatus,
} from "../session.ts";
export { isTurriError, TurriError, type TurriErrorCode } from "../errors.ts";
export type { ClientInfo } from "../client.ts";
export type { ModelOutOfReach } from "../chat-model.ts";
export { MAX_CHATS, type ChatInfo, type ChatStatus } from "../chats.ts";
export type { RunRecord } from "../chat-records.ts";
export {
  BANNER_ENTRY,
  COMMAND_OUTCOME,
  CONCLUDED_ENTRY,
  HISTORY_ENTRY,
  INTERVIEW_ENTRY,
  JOB_ENTRY,
  JOB_LANDED_MESSAGE,
  JOBS_LIST_ENTRY,
  LAUNCH_MESSAGE,
  MILESTONE_ENTRY,
  NOTICE_ANSWER_MESSAGE,
  NOTICE_ENTRY,
  NOTICE_OVER_ENTRY,
  SENTINEL_CHECK_MESSAGE,
  SENTINEL_PULSE_MESSAGE,
  SENTINEL_RESUME_MESSAGE,
  SIDE_ENTRY,
  SKILL_MESSAGE_ENTRY,
  SKILL_REPORT_ENTRY,
  SKILL_RUN_ENTRY,
  SPEC_CONFLICT_MESSAGE,
  VERSION_ENTRY,
  isChatEntry,
  isChatEntryOf,
  type BannerData,
  type ChatEntry,
  type ChatEntryMap,
  type ChatEntryOf,
  type ChatEntryType,
  type ChatMessageMap,
  type ChatMessageOf,
  type CommandOutcome,
  type Exchange,
  type JobAnnouncement,
} from "../chat-entries.ts";
export type { SkillProgress } from "../session-events.ts";
export type { SessionSpending } from "../session-spending.ts";
export { CAPTURE_PHASES, COMPACT_PHASES, capturePhases, captureStageText, type CaptureStatus } from "../capture/progress.ts";
export type { CaptureResult } from "../capture/capture.ts";
export { SENTINEL, SENTINEL_START, type Conclusion, type Notice, type NoticeAction, type NoticeAnswer, type NoticeSeverity, type NoticeState, type SentinelCheck } from "../notice.ts";
export type { CheckRequest } from "../sentinel-check.ts";
export { launchText, type Launch, type LaunchStatus, type LaunchStopped } from "../launch-track.ts";
export { formatDuration, pulseName, type Job, type JobDetails, type PulseCases, type PulseSpec } from "../regenerate/jobs.ts";
export { didNotPass, pulseCost } from "../regenerate/job-panel.ts";
export { describeAgents, type ModelEvent, type TranscriptEntry } from "../regenerate/activity.ts";
export type { SpecGap } from "../regenerate/notes.ts";
export type { DriftReport, ModuleStatus, PlannedPulse } from "../regenerate/loop.ts";
export type { ModuleStanding } from "../regenerate/standing.ts";
export type { ModuleState } from "../run-report.ts";
export type { RunView } from "../regenerate/ledger-view.ts";
export { countOf, focusOf, hasScenarioViews, lineDiff, rungOf, type Mark, type MarkedItem, type MarkedPage, type Rung } from "../regenerate/spec-map.ts";
export type { ExportResult, StartOverQuestion, WorkRequest, WorkResult, WorkRunOptions } from "../work.ts";

// The types the session's data reaches, each nameable by a front end.
export type { ChatRole, NoticeInput } from "../notice.ts";
export type { ChatRecord } from "../chat-records.ts";
export type { ConfigLine, ConfigLineKind } from "../config.ts";
export type { ModelRole, SettingKey, SettingValues } from "../config-edit.ts";
export type { JobRef, TranscriptRecord } from "../chat-entries.ts";
export type { JobStatus } from "../regenerate/jobs.ts";
export type { AgentTally, BuildingSpec, SpecConflict, UsageReport } from "../regenerate/activity.ts";
export type { JobCases, ScenarioCases, ScenarioRef, TouchedSpec } from "../regenerate/drift.ts";
export type { LaunchCause } from "../launch-track.ts";
export type { ExportedCode, LaunchedProcess } from "../regenerate/launch.ts";
export type { ItemState, MapItem, MapPage, MapScenarios } from "../regenerate/spec-map.ts";
export type { MapCodebase, MapPulse, ModuleCompletion, Track } from "../regenerate/loop.ts";
export type { CaptureAgentStatus, CaptureStage } from "../capture/progress.ts";
export type { AgentRef, LedgerEntry, LedgerEvent } from "../regenerate/ledger.ts";
export type { LedgerEntryOf, PulseView } from "../regenerate/ledger-view.ts";
export type { DiffWhere } from "../regenerate/diff-where.ts";
export type { ScriptKind } from "../regenerate/test-scripts.ts";
export type { SandboxSummary, Wall } from "../regenerate/os-sandbox.ts";

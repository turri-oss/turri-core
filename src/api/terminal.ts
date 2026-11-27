/** The CLI's driver and view: register them against the same pi peer as the core. */
export { default, createTurriCore, processSession, shownJobs, plannedLoop, sessionLaunchesOf, echoCommand, shownAfterCommand } from "../extension.ts";
export { interruptChat, type ChatDriver, type ChatLink, type ChatState, type Stoppable, type TurriCore } from "../chats.ts";
export { unqueue, type QueueOf } from "../chat-queue.ts";
export { lastRun, type RunRecord } from "../chat-records.ts";
export { BANNER_ENTRY, VERSION_ENTRY, COMMAND_OUTCOME, SIDE_ENTRY, SKILL_MESSAGE_ENTRY, INTERVIEW_ENTRY, JOB_ENTRY, HISTORY_ENTRY, MILESTONE_ENTRY, JOBS_LIST_ENTRY, NOTICE_ENTRY, NOTICE_OVER_ENTRY, CONCLUDED_ENTRY, SKILL_RUN_ENTRY, SKILL_REPORT_ENTRY, type BannerData, type CommandOutcome, type Exchange, type JobAnnouncement } from "../chat-entries.ts";
export { CAPTURE_PHASES, COMPACT_PHASES, capturePhases, captureStageText, duration, workOf, type CaptureStatus } from "../capture/progress.ts";
export { PANEL_KEY, spinner, didNotPass, finishedMark, pulseCost, summarizeDiff, type DiffStyle } from "../regenerate/job-panel.ts";
export { countOf, createSpecMapSource, defaultMapFiles, focusOf, hasScenarioViews, lineDiff, rungOf, type Rung, type Mark, type MarkedPage, type MarkedItem } from "../regenerate/spec-map.ts";
export { DIFF_HEADER, locateDiffLines, type DiffWhere } from "../regenerate/diff-where.ts";
export { describeAgents } from "../regenerate/activity.ts";
export { formatDuration, pulseName } from "../regenerate/jobs.ts";
export type { SpecGap } from "../regenerate/notes.ts";

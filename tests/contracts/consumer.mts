// Compiled and run in a separate npm project, against the tarball, by scripts/package-contract.mjs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { BANNER_ENTRY, capturePhases, createTurri, isChatEntry, isChatEntryOf, isTurriError, rungOf, type ChatEntry, type SkillReport, type StartOverQuestion, type Turri, type TurriEvent, type WorkRunOptions } from "@turri-dev/core";
import { checkPlainFile, highlightLines, isStack, plainGraph, stdlibTemplates } from "@turri-dev/core/plain";
import { checkModule, configForSpec, configLines, configSettings, configuredModel, credentialsFile, historyLog, readDrift, readLedger, readProjectConfig, runViews, savedChatFiles } from "@turri-dev/core/project";
import { bedrockModels, hasBedrockPreset, loginDeviceId } from "@turri-dev/core/models";
import { asksModels, checkNode, coreVersion, doctor } from "@turri-dev/core/system";

const project = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR!;
const file = join(project, "app.plain");
writeFileSync(file, "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# greet\nSay hello.\n");
writeFileSync("config.turri.yaml", "sentinel: false\n");

// /plain: the language alone.
assert.equal(checkPlainFile(file).ok, true);
assert.equal(plainGraph(project).modules.some((module) => module.module === "app"), true);
assert.ok(highlightLines(["# greet"])[0]!.length);
assert.ok(stdlibTemplates().length);
assert.ok(isStack({ name: "stdlib/backend/python-flask" })); // a catalogue may name a stack by its import name alone

// /project: the project on disk, with no session.
assert.equal(checkModule(file).ok, true);
assert.equal(configForSpec(file).sentinel, false);
assert.ok(configSettings().some((setting) => setting.key === "sentinel"));
assert.deepEqual(configLines(project), []);
const settingsDir = join(project, "settings");
mkdirSync(settingsDir);
const versioned = "amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0";
writeFileSync(join(settingsDir, "config.turri.yaml"), `harness-model: ${versioned}\nmodels:\n  coding: { thinking: high, turn-limit: 3 }\n  judge: { turn-limit: 7 }\n`);
const settings = readProjectConfig(settingsDir);
assert.deepEqual(configuredModel(settings, "harness-model"), { model: versioned });
assert.deepEqual(configuredModel(settings, "models.coding"), { thinking: "high" });
assert.equal(configuredModel(settings, "models.judge"), undefined);
assert.equal(credentialsFile(agentDir), join(agentDir, "auth.json"));
assert.deepEqual(await savedChatFiles(project, join(project, "sessions")), []);
assert.equal(readDrift(file)[0]?.module, "app");
assert.equal(historyLog("app"), "No history for app yet.");
assert.equal(existsSync("plain_modules"), false);

// /models and /system.
const choice = { maker: "anthropic", region: "global" } as const;
assert.ok(hasBedrockPreset(choice));
assert.match(bedrockModels(choice).harness, /^amazon-bedrock\/global\.anthropic\./);
assert.equal(typeof loginDeviceId(project, agentDir), "string");
assert.equal(checkNode().level, "ok");
assert.equal(asksModels({ dir: project, models: true, overrides: { harnessModel: "anthropic/claude-named" } }), true);
assert.equal(typeof coreVersion().version, "string");
assert.equal((await doctor())[0]?.name, "Node"); // the checks load as doctor runs

// pi can replay records from other extensions or older writers. A job without details is not a typed job announcement.
const message = { type: "custom_message", content: "finished", display: false } as const;
assert.equal(isChatEntry({ ...message, customType: "another_extension" }), false);
assert.equal(isChatEntry({ ...message, customType: "turri_job" }), false);

// The session, as a front end on turri's own chat sessions opens it.
const events: TurriEvent[] = [];
const turri = await createTurri({ frontend: {}, agentDir, sessionDir: join(project, "sessions"), onEvent: (event) => events.push(event) });
try {
  await assert.rejects(createTurri(), (error: unknown) => isTurriError(error, "session-open"));
  assert.deepEqual(turri.work.status(), { jobs: [], modules: [], planned: [], busy: false });
  // Settings by their keys, each value its type.
  const sentinel: boolean | "ask" | undefined = turri.settings.get("sentinel");
  assert.equal(sentinel, false);
  await turri.settings.set("agent-env.vars", ["HOME"]);
  const vars: string[] | undefined = turri.settings.get("agent-env.vars");
  assert.deepEqual(vars, ["HOME"]);
  // @ts-expect-error a key there is no setting of
  assert.throws(() => turri.settings.get("no-such-setting"), (error: unknown) => isTurriError(error, "not-found"));
  // @ts-expect-error a setting's value of another type
  await assert.rejects(turri.settings.set("review", "maybe"), (error: unknown) => isTurriError(error, "refused"));
  assert.deepEqual(turri.launches.list(), []);
  assert.deepEqual(turri.work.standing([file])[0]?.drift, readDrift(file));
  const chat = await turri.chats.open();
  assert.equal(readLedger(project)[0]?.kind, "run.started");
  assert.equal(runViews(project).length, 1);
  assert.ok(chat.session instanceof AgentSession, "core and front end must use the same pi instance");
  assert.equal(chat.outOfReach(), undefined); // no harness-model: pi's own choice
  await turri.chats.onHarnessModel();
  const banner = (entry: ChatEntry) => isChatEntryOf(entry, BANNER_ENTRY) && typeof entry.data.version === "string";
  assert.ok(events.some((event) => event.type === "entry" && event.chat === chat.id && banner(event.entry)));
  assert.ok(chat.entries().some(banner));
  await chat.session.sendCustomMessage({ customType: "turri_command_outcome", content: "read the plan", display: false });
  const outcome = (entry: ChatEntry) => entry.type === "custom_message" && entry.customType === "turri_command_outcome" && entry.content === "read the plan";
  assert.ok(events.some((event) => event.type === "entry" && event.chat === chat.id && outcome(event.entry)));
  // Every event is plain data: a front end may send it to another process as it is.
  for (const event of events) assert.deepEqual(structuredClone(event), event);
  // A reopened conversation's history is visible, but spending before this run is not billed to it again.
  const savedDir = join(project, "saved");
  mkdirSync(savedDir);
  const history = SessionManager.create(project, savedDir);
  const usage = (cost: number) => ({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
    cost: { input: 0, output: cost, cacheRead: 0, cacheWrite: 0, total: cost } });
  history.appendMessage({ role: "assistant", api: "openai-completions", provider: "stub", model: "test", content: [{ type: "text", text: "saved" }], stopReason: "stop", timestamp: Date.now(), usage: usage(5) });
  const saved = await turri.chats.open({ sessionFile: history.getSessionFile()! });
  assert.equal(saved.session.getSessionStats().cost, 5);
  assert.equal(turri.spending().chat, 0);
  saved.session.sessionManager.appendUsage("call", "stub", "test", usage(2));
  assert.equal(turri.spending().chat, 2);
  await turri.chats.close(saved.id);
  assert.equal(turri.spending().chat, 2);
  assert.throws(() => saved.session, (error: unknown) => isTurriError(error, "chat-closed"));
} finally {
  await turri.dispose();
}

// A command at a terminal: it answers questions, and has no chats.
const command = await createTurri({ frontend: { sessions: { kind: "none" }, ask: async (_question, context) => (context.chat === undefined ? "No" : undefined) }, client: { name: "consumer", version: "0.0.0", mode: "regenerate" } });
try {
  await assert.rejects(command.chats.open(), (error: unknown) => isTurriError(error, "no-chat"));
} finally {
  await command.dispose();
}

// What a skill run says as it goes: each gate's decision, told apart by its kind.
const decided = (report: SkillReport) => (report.kind === "outcome" ? report.decision : undefined);
assert.equal(decided({ kind: "outcome", step: "draft", decision: "retry", critique: "" }), "retry");

// A skill by name, or the one in a folder.
const skillAsked: Array<Parameters<Turri["skills"]["run"]>[0]> = ["init-config", { dir: "skills/mine" }];
assert.equal(skillAsked.length, 2);

// A run's start over, answered by whoever runs it - a command at its terminal.
const startOver: WorkRunOptions["startOver"] = async (question: StartOverQuestion) => (question.codebases.length > 0 ? false : undefined);
assert.equal(typeof startOver, "function");

// turri's words for its data, for any front end to show.
assert.equal(typeof rungOf, "function");
const compact = capturePhases({ stage: "compact-writing", pipeline: "compact" });
const staged = capturePhases({ stage: "capturing", pipeline: "staged" });
assert.deepEqual([compact.current, compact.phases.length, compact.phases[compact.current]], [1, 5, "features"]);
assert.deepEqual([staged.current, staged.phases.length, staged.phases[staged.current]], [2, 8, "features"]);

assert.throws(() => import.meta.resolve("@turri-dev/core/dist/extension.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
for (const gone of ["host", "terminal", "startup", "commands", "config", "ledger", "cli-compat"]) {
  assert.throws(() => import.meta.resolve(`@turri-dev/core/${gone}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }, gone);
}

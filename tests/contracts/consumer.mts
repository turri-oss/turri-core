// Compiled and run in a separate npm project, against the tarball, by scripts/package-contract.mjs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createTurri, isChatEntry, type SessionEvent, type ChatEntry } from "@turri-dev/core";
import { credentialsFile, savedChatFiles } from "@turri-dev/core/host";
import { checkPlainFile, highlightLines, isStack, plainGraph, stdlibTemplates } from "@turri-dev/core/plain";
import { bedrockModels, configForSpec, configLines, configSettings, configuredModel, hasBedrockPreset, readProjectConfig } from "@turri-dev/core/config";
import { readLedger, runViews } from "@turri-dev/core/ledger";
import { readDrift } from "@turri-dev/core/commands";
import { BANNER_ENTRY, capturePhases, rungOf, type TurriView } from "@turri-dev/core/terminal";

const project = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR!;
const file = join(project, "app.plain");
writeFileSync(file, "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# greet\nSay hello.\n");
writeFileSync("config.turri.yaml", "sentinel: false\n");
assert.equal(checkPlainFile(file).ok, true);
assert.equal(plainGraph(project).modules.some((module) => module.module === "app"), true);
assert.ok(highlightLines(["# greet"])[0]!.length);
assert.ok(stdlibTemplates().length);
assert.ok(isStack({ name: "stdlib/backend/python-flask" })); // the desktop's catalogue uses the import name alone
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
assert.equal(configuredModel(settings, "coding-model"), undefined);
const choice = { maker: "anthropic", region: "global" };
assert.ok(hasBedrockPreset(choice));
assert.match(bedrockModels(choice).harness, /^amazon-bedrock\/global\.anthropic\./);
assert.equal(hasBedrockPreset({ maker: "another-maker", region: "global" }), false);
assert.equal(credentialsFile(agentDir), join(agentDir, "auth.json"));
assert.deepEqual(await savedChatFiles(project, join(project, "sessions")), []);
assert.equal(readDrift(file)[0]?.module, "app");
assert.equal(existsSync("plain_modules"), false);

// pi can replay records from other extensions or older writers. A job without details is not a typed job announcement.
const message = { type: "custom_message", content: "finished", display: false } as const;
assert.equal(isChatEntry({ ...message, customType: "another_extension" }), false);
assert.equal(isChatEntry({ ...message, customType: "turri_job" }), false);

const events: SessionEvent[] = [];
const session = await createTurri({ agentDir, sessionDir: join(project, "sessions"), onEvent: (e) => events.push(e) });
try {
  assert.deepEqual(session.status(), { jobs: [], modules: [], planned: [] });
  assert.deepEqual(session.launches(), []);
  assert.deepEqual(session.standing([file])[0]?.drift, readDrift(file));
  const chat = await session.openChat();
  assert.equal(readLedger(project)[0]?.kind, "run.started");
  assert.equal(runViews(project).length, 1);
  assert.ok(chat.session instanceof AgentSession, "core and host must use the same pi instance");
  const banner = (entry: ChatEntry) => entry.type === "custom" && entry.customType === BANNER_ENTRY && typeof entry.data.version === "string";
  assert.ok(events.some((e) => e.type === "entry" && e.chat === chat.id && banner(e.entry)));
  assert.ok(session.entries(chat.id).some(banner));
  await chat.session.sendCustomMessage({ customType: "turri_command_outcome", content: "read the plan", display: false });
  const outcome = (entry: ChatEntry) => entry.type === "custom_message" && entry.customType === "turri_command_outcome" && entry.content === "read the plan";
  assert.ok(events.some((e) => e.type === "entry" && e.chat === chat.id && outcome(e.entry)));
  assert.ok(session.entries(chat.id).some(outcome));
  // A reopened conversation's history is visible, but spending before this run is not billed to it again.
  const savedDir = join(project, "saved");
  mkdirSync(savedDir);
  const history = SessionManager.create(project, savedDir);
  const usage = (cost: number) => ({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
    cost: { input: 0, output: cost, cacheRead: 0, cacheWrite: 0, total: cost } });
  history.appendMessage({ role: "assistant", api: "openai-completions", provider: "stub", model: "test", content: [{ type: "text", text: "saved" }], stopReason: "stop", timestamp: Date.now(), usage: usage(5) });
  const saved = await session.openChat({ sessionFile: history.getSessionFile()! });
  assert.equal(saved.session.getSessionStats().cost, 5);
  assert.equal(session.spending().chat, 0);
  saved.session.sessionManager.appendUsage("call", "stub", "test", usage(2));
  assert.equal(session.spending().chat, 2);
  await session.closeChat(saved.id);
  assert.equal(session.spending().chat, 2);
} finally {
  await session.dispose();
}

const view: TurriView = { skillProgress(_ctx, progress) { if (progress) assert.ok(progress.current < progress.phases.length); } };
assert.equal(typeof view.skillProgress, "function");
assert.equal(typeof rungOf, "function");
const compact = capturePhases({ stage: "compact-writing", pipeline: "compact" });
const staged = capturePhases({ stage: "capturing", pipeline: "staged" });
assert.deepEqual([compact.current, compact.phases.length, compact.phases[compact.current]], [1, 5, "features"]);
assert.deepEqual([staged.current, staged.phases.length, staged.phases[staged.current]], [2, 8, "features"]);

assert.throws(() => import.meta.resolve("@turri-dev/core/dist/extension.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });

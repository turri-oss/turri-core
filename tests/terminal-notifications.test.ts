import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTurriCore } from "../src/extension.ts";

const cwd = process.cwd();
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "turri-notifications-")); process.chdir(dir); });
afterEach(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });

async function terminal(setting: "ask" | "false") {
  writeFileSync("config.turri.yaml", `sentinel: ${setting}\n`);
  const core = createTurriCore();
  const appendEntry = vi.fn();
  const sendMessage = vi.fn();
  const pi = new Proxy({ appendEntry, sendMessage }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as unknown as ExtensionAPI;
  core.setDriver({ terminal: true, async create() { core.extension(pi); }, async dispose() {} });
  await core.open();
  const job = core.jobs.start({ kind: "regenerate", summary: "change greeting", module: "app", pulse: 1, run: async () => ({ report: "Greeting updated", details: { passed: true, landed: true } }) });
  await core.jobs.wait(job.id);
  return { core, appendEntry, sendMessage, job };
}

it("puts the pulse in the centre immediately while consent is pending, without posting it again when consent is declined", async () => {
  const { core, appendEntry, sendMessage } = await terminal("ask");
  const items = core.notifications.items;
  expect(items).toHaveLength(2);
  expect(items[1]).toMatchObject({ title: expect.stringContaining("pulse 1"), detail: "Greeting updated" });
  expect(items[0]!.notice?.kind).toBe("sentinel-start");
  core.answer(items[0]!.notice!.id, { dismiss: true });
  expect(items).toHaveLength(2);
  expect(appendEntry).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "turri_job", display: false }), { triggerTurn: false });
});

it("keeps the panel button busy until the last concurrent pulse finishes", async () => {
  const { core } = await terminal("false");
  const panel = core.shownChat()!.instance!.plainPanel!;
  expect(panel.busy()).toBe(false);
  core.jobs.setMaxRunning(2);
  const releases: Array<() => void> = [];
  const jobs = ["regenerate", "conformance"].map((kind) => core.jobs.start({ kind, summary: kind, run: async () => {
    await new Promise<void>((done) => releases.push(done));
    return { report: "done" };
  } }));
  await vi.waitFor(() => expect(releases.length).toBe(2));
  expect(panel.busy()).toBe(true);
  releases[0]!();
  await core.jobs.wait(jobs[0]!.id);
  expect(panel.busy()).toBe(true);
  releases[1]!();
  await core.jobs.wait(jobs[1]!.id);
  expect(panel.busy()).toBe(false);
});

it("shows evidence beside pulses and only starts the chat on an accepted, still-open action", async () => {
  const { core, appendEntry, sendMessage, job } = await terminal("false");
  expect(core.notifications.items.map((item) => item.detail)).toEqual(["Greeting updated"]);
  core.concluded({ job: job.id, verdict: "wrong", summary: "No greeting on stdout" });
  const input = { module: "app", job: job.id, severity: "warning" as const, summary: "Missing greeting", evidence: ["stdout was empty"], actions: [{ label: "Fix greeting", task: "Restore the greeting" }] };
  const notice = core.notice(input)!;
  // The panel's "notifications 2": the pulse and the sentinel's review of it, neither seen.
  expect(core.notifications.count).toBe(2);
  // What the panel's "mark all as read" does (turri's notificationView): every row seen - the notice still open counted.
  for (const item of core.notifications.items) item.seen = true;
  expect(core.notifications.count).toBe(1);
  // What the panel draws of "Missing greeting" - in the warning colour - and shows in its detail: the evidence, beside the conclusion.
  expect(core.notifications.items.find((item) => item.notice === notice)).toMatchObject({ warning: true, detail: "stdout was empty", conclusion: expect.stringContaining("No greeting on stdout") });
  // Seen - as opening its detail and going back marks it - it is still open: only an answer closes it.
  expect(notice.state).toBe("open");
  core.notice({ ...input, job: "later-pulse", summary: "Missing prefix" });
  expect(notice.state).toBe("superseded");
  expect(sendMessage.mock.calls.every(([, options]) => options.triggerTurn === false)).toBe(true);
  expect(appendEntry).not.toHaveBeenCalled();
  // What the panel's "1. Fix greeting" answers on the notice still open (turri's notificationView): its first action.
  core.answer(core.notifications.items.find((item) => item.notice?.state === "open")!.notice!.id, { action: 0 });
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ customType: "turri_notice_answer", content: expect.stringContaining("Restore the greeting") }), expect.objectContaining({ triggerTurn: true }));
  expect(core.notices()).toHaveLength(0);
  expect(appendEntry).not.toHaveBeenCalled();
});

it("marks a failed pulse and a build that did not pass as warnings independently of their wording", async () => {
  const { core, job } = await terminal("false");
  core.jobFinished({ ...job, status: "failed", error: "Process exited" });
  core.jobFinished({ ...job, details: { passed: false } });
  expect(core.notifications.items.map((row) => row.warning)).toEqual([true, true, false]);
  core.concluded({ job: job.id, verdict: "holds", summary: "No failure found" });
  expect(core.notifications.items[0]!.warning).toBe(false);
});

it("adds the conclusion to a dismissed finding without a second row, badge or action", async () => {
  const { core, job } = await terminal("false");
  const notice = core.notice({ job: job.id, summary: "Shutdown takes too long", severity: "warning", actions: [], evidence: ["11 seconds"] })!;
  const row = core.notifications.items[0]!;
  row.seen = true;
  core.answer(notice.id, { dismiss: true });
  const count = core.notifications.count;
  core.concluded({ job: job.id, verdict: "wrong", summary: "The timeout does not hold" });
  expect(core.notifications.items).toHaveLength(2); // the pulse itself, and its sentinel review
  expect(core.notifications.items[0]).toBe(row);
  expect(row).toMatchObject({ notice: { state: "dismissed" }, detail: "11 seconds", conclusion: expect.stringContaining("timeout") });
  expect(core.notifications.count).toBe(count);
  core.concluded({ check: job.id, verdict: "holds", summary: "A separate requested check" });
  expect(core.notifications.items).toHaveLength(3);
});

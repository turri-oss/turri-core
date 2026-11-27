import { describe, expect, it } from "vitest";
import { BANNER_ENTRY, isChatEntry, isChatEntryOf, JOB_LANDED_MESSAGE, LAUNCH_MESSAGE, NOTICE_ENTRY, NOTICE_ANSWER_MESSAGE, SIDE_ENTRY, type ChatEntry } from "../src/chat-entries.ts";

/** What a front end reads of a chat: turri's own records told from pi's and from each other, by their type. */

const records = [
  { type: "message", message: { role: "user", content: "hi" } },
  { type: "custom", customType: SIDE_ENTRY, data: { question: "why?", answer: "because." } },
  { type: "custom", customType: "someone_elses", data: { anything: 1 } },
  { type: "custom", customType: SIDE_ENTRY, data: null },
  { type: "custom_message", customType: JOB_LANDED_MESSAGE, content: "landed", display: false, details: { jobId: "a1", status: "succeeded" } },
  { type: "custom_message", customType: JOB_LANDED_MESSAGE, content: "landed", display: false },
  { type: "custom_message", customType: NOTICE_ANSWER_MESSAGE, content: "do it", display: false },
] as never[];

describe("a chat's records", () => {
  it("are turri's when their type is turri's and their payload is what that type carries - safe as an array filter", () => {
    const turri: ChatEntry[] = records.filter(isChatEntry);
    expect(turri.map((entry) => entry.customType)).toEqual([SIDE_ENTRY, JOB_LANDED_MESSAGE, NOTICE_ANSWER_MESSAGE]);
  });

  it("narrow to one type, its data typed", () => {
    const side = records.find((entry) => isChatEntryOf(entry, SIDE_ENTRY));
    expect(side !== undefined && isChatEntryOf(side, SIDE_ENTRY) ? side.data.answer : undefined).toBe("because.");
    expect(records.filter((entry) => isChatEntryOf(entry, JOB_LANDED_MESSAGE))).toHaveLength(1);
  });
});

describe("what a record of turri's carries", () => {
  const notice = { id: "n1", chat: "c1", state: "open", at: "2026-11-27T10:00:00Z", severity: "error", summary: "It broke.", evidence: ["step 2 failed"], actions: [{ label: "Fix it", task: "Fix step 2." }] };
  const entry = (customType: string, data: unknown) => ({ type: "custom", customType, data }) as never;

  it("is checked field by field: a missing field, a field of another type or a word its type does not take is not turri's", () => {
    expect(isChatEntry(entry(NOTICE_ENTRY, notice))).toBe(true);
    expect(isChatEntry(entry(NOTICE_ENTRY, { ...notice, chat: undefined }))).toBe(false);
    expect(isChatEntry(entry(NOTICE_ENTRY, { ...notice, evidence: "step 2 failed" }))).toBe(false);
    expect(isChatEntry(entry(NOTICE_ENTRY, { ...notice, severity: "fatal" }))).toBe(false);
    expect(isChatEntry(entry(NOTICE_ENTRY, { ...notice, actions: [{ label: "Fix it" }] }))).toBe(false);
    expect(isChatEntry(entry(SIDE_ENTRY, { question: "why?" }))).toBe(false);
  });

  it("takes a field it does not know - a later turri's - and an optional one left out, as an earlier turri left it", () => {
    expect(isChatEntry(entry(BANNER_ENTRY, { version: "0.2.0", pending: 0, fromLater: true }))).toBe(true);
    expect(isChatEntry(entry(BANNER_ENTRY, { version: "0.1.0", pending: 0, sandbox: { level: "ok", text: "Seatbelt" }, config: [{ kind: "unknown", file: "config.turri.yaml", text: "colour: blue" }] }))).toBe(true);
    expect(isChatEntry(entry(BANNER_ENTRY, { version: "0.1.0", pending: "none" }))).toBe(false);
  });

  it("checks a message's details as an entry's data, and one that carries none carries none", () => {
    const message = (customType: string, details: unknown) => ({ type: "custom_message", customType, content: "", display: false, details }) as never;
    expect(isChatEntry(message(LAUNCH_MESSAGE, { launch: "launch-1", status: "launched" }))).toBe(true);
    expect(isChatEntry(message(LAUNCH_MESSAGE, { launch: "launch-1", status: "up" }))).toBe(false);
    expect(isChatEntry(message(JOB_LANDED_MESSAGE, { jobId: 7, status: "succeeded" }))).toBe(false);
    expect(isChatEntry(message(NOTICE_ANSWER_MESSAGE, { task: "do it" }))).toBe(false);
  });
});

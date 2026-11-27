import { describe, expect, it } from "vitest";
import { isChatEntry, isChatEntryOf, JOB_LANDED_MESSAGE, NOTICE_ANSWER_MESSAGE, SIDE_ENTRY, type ChatEntry } from "../src/chat-entries.ts";

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
  it("are turri's when their type is turri's and their payload has its envelope - safe as an array filter", () => {
    const turri: ChatEntry[] = records.filter(isChatEntry);
    expect(turri.map((entry) => entry.customType)).toEqual([SIDE_ENTRY, JOB_LANDED_MESSAGE, NOTICE_ANSWER_MESSAGE]);
  });

  it("narrow to one type, its data typed", () => {
    const side = records.find((entry) => isChatEntryOf(entry, SIDE_ENTRY));
    expect(side !== undefined && isChatEntryOf(side, SIDE_ENTRY) ? side.data.answer : undefined).toBe("because.");
    expect(records.filter((entry) => isChatEntryOf(entry, JOB_LANDED_MESSAGE))).toHaveLength(1);
  });
});

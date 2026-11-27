import { describe, expect, it } from "vitest";
import { unqueue, type QueueOf } from "../src/chat-queue.ts";

describe("a message a skill's agent read", () => {
  it("is taken out of the chat's queue, the rest put back in order and kind - as turri's, not typed again", async () => {
    let steering = ["first", "make it blue", "second"];
    let followUp = ["later"];
    const put: string[] = [];
    const session: QueueOf = {
      getSteeringMessages: () => steering,
      getFollowUpMessages: () => followUp,
      clearQueue: () => {
        const was = { steering, followUp };
        steering = [];
        followUp = [];
        return was;
      },
      steer: async (text, _images, options) => (put.push(`${options?.source}: ${text}`), steering.push(text)),
      followUp: async (text, _images, options) => (put.push(`${options?.source}: ${text}`), followUp.push(text)),
    };
    expect(await unqueue(session, "make it blue")).toBe(true);
    expect(steering).toEqual(["first", "second"]);
    expect(followUp).toEqual(["later"]);
    expect(put.every((line) => line.startsWith("extension: "))).toBe(true);
    expect(await unqueue(session, "never sent")).toBe(false);
  });
});

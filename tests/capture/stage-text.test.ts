import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE_PHASES, captureStageText, COMPACT_PHASES, phaseOf, workOf, type CaptureStatus } from "../../src/capture/progress.ts";

const ROOT = join(sep, "home", "node", "shorty");

function status(over: Partial<CaptureStatus> = {}): CaptureStatus {
  return { root: ROOT, started: 0, stage: "capturing", features: { outlined: 8, done: 3 }, outlining: 0, work: { done: 0, total: 0 }, agents: [], cost: 0, ...over };
}

/** Where the capture is, in words, as a view draws it: with the phase's work as workOf counts it. */
const said = (over: Partial<CaptureStatus>) => {
  const shown = status(over);
  return captureStageText(shown, workOf(shown));
};

describe("a capture's stage in words", () => {
  it("counts the features captured and the agents at work on them", () => {
    expect(said({ agents: [{ label: "feature shorty#a", since: 0 }, { label: "feature shorty#b", since: 0 }] })).toBe("3 of 8 features captured, 2 at work");
    expect(said({ stage: "surveying" })).toBe("surveying the codebase");
    expect(said({ stage: "outlining", features: { outlined: 0, done: 0 } })).toBe("outlining the features");
    expect(said({ stage: "outlining", outlining: 2 })).toBe("8 features outlined, 2 areas still being outlined");
  });

  it("says each counted stage's work done, and its words alone while it is not counted", () => {
    expect(said({ stage: "dividing", work: { done: 0, total: 1 } })).toBe("giving each behaviour to one feature");
    expect(said({ stage: "checking", work: { done: 0, total: 1 } })).toBe("checking the conventions against the code");
    expect(said({ stage: "filling", work: { done: 1, total: 2 } })).toBe("capturing the interface no feature named: 1 of 2 writers done");
    expect(said({ stage: "verifying", work: { done: 2, total: 6 } })).toBe("2 of 6 modules checked against the code");
    expect(said({ stage: "scripts", work: { done: 1, total: 2 } })).toBe("1 of 2 testing scripts written");
    expect(said({ stage: "reading", work: { done: 0, total: 3 } })).toBe("0 of 3 modules read for readability");
    expect(said({ stage: "gathering", work: { done: 0, total: 1 } })).toBe("gathering the features into modules by concern, in the order they are built");
    expect(said({ stage: "trying", work: { done: 2, total: 5 } })).toBe("trying the scenarios on the original: 2 of 5 agents done");
    expect(said({ stage: "verifying" })).toBe("checking the interface against the code");
  });

  it("names a compact capture's phases among the staged ones, in their order", () => {
    expect(COMPACT_PHASES.map((phase) => CAPTURE_PHASES.indexOf(phase))).toEqual([0, 2, 5, 6, 7]);
    expect(COMPACT_PHASES.indexOf(CAPTURE_PHASES[phaseOf("compact-writing")]!)).toBe(1);
  });
});

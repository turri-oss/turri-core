import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { activityLine, CAPTURE_PHASES, CaptureTracker, COMPACT_PHASES, duration, phaseOf, workOf, type CaptureStatus } from "../../src/capture/progress.ts";
import { newState } from "../../src/capture/state.ts";

const ROOT = join(sep, "home", "node", "shorty");

function status(over: Partial<CaptureStatus> = {}): CaptureStatus {
  return { root: ROOT, started: 0, stage: "capturing", features: { outlined: 8, done: 3 }, outlining: 0, work: { done: 0, total: 0 }, agents: [], cost: 0, ...over };
}

/** Where a capture is among its phases, as its first line says it (turri's captureStatusLines): the phase, and how far through them. */
function phaseAt(over: Partial<CaptureStatus> = {}): string {
  const shown = status(over);
  const phases = shown.pipeline === "compact" ? COMPACT_PHASES : CAPTURE_PHASES;
  const current = phases.indexOf(CAPTURE_PHASES[phaseOf(shown.stage)]!);
  return `${phases[current]}, phase ${current + 1} of ${phases.length}`;
}

describe("a capture's status", () => {
  it("puts each stage in its phase, and says how far through the phases - a staged capture's eight, a compact one's five - it is", () => {
    expect(CAPTURE_PHASES).toEqual(["survey", "outline", "features", "concepts", "readability", "interface", "trial", "scripts"]);
    expect(COMPACT_PHASES).toEqual(["survey", "features", "interface", "trial", "scripts"]);
    expect(phaseAt()).toBe("features, phase 3 of 8");
    expect(phaseAt({ pipeline: "compact", stage: "compact-writing" })).toBe("features, phase 2 of 5");
    expect(phaseAt({ stage: "checking" })).toBe("survey, phase 1 of 8");
    expect(phaseAt({ stage: "dividing" })).toBe("outline, phase 2 of 8");
    expect(phaseAt({ stage: "gathering" })).toBe("features, phase 3 of 8");
    expect(phaseAt({ stage: "verifying" })).toBe("interface, phase 6 of 8");
    expect(phaseAt({ stage: "trying" })).toBe("trial, phase 7 of 8");
    expect(phaseAt({ stage: "scripts" })).toBe("scripts, phase 8 of 8");
  });

  it("counts the phase's work for its strip - the features done, the feature agents at work - and none while its stage is not counted", () => {
    expect(workOf(status({ agents: [{ label: "outline shorty", since: 0 }] }))).toEqual({ total: 8, done: 3, running: 0 });
    expect(workOf(status({ stage: "surveying" }))).toBeUndefined();
  });

  it("says a tool call without the agent's role, the model's time or the codebase's own folder", () => {
    expect(activityLine(`(capture) ○ read ${join(ROOT, "app", "main.py")}   (model 3.2s)`, ROOT)).toBe(`○ read ${join("app", "main.py")}`);
    expect(activityLine("  ✗ read failed", ROOT)).toBe("✗ read failed");
  });

  it("says a duration in seconds, minutes or hours", () => {
    expect([duration(9_400), duration(130_000), duration(3_900_000)]).toEqual(["9s", "2m 10s", "1h 05m"]);
  });

  it("follows each agent from its start to its end, and counts the features from the state", () => {
    const changes: string[] = [];
    const tracker = new CaptureTracker(ROOT, undefined, (now) => changes.push(`${now.stage} ${now.agents.map((agent) => `${agent.label}:${agent.did ?? ""}`).join(",")}`));
    const agent = tracker.agent("survey", "Survey the codebase");
    agent.did("(capture) ○ read pyproject.toml");
    agent.started();
    agent.did("(capture) ○ read pyproject.toml");
    agent.spent(0.5);
    expect(tracker.status.agents).toMatchObject([{ label: "survey", did: "○ read pyproject.toml" }]);
    agent.ended();
    expect(tracker.status.agents).toEqual([]);
    expect(tracker.status.cost).toBe(0.5);
    // What an agent says before it starts, or after it ends, is not shown.
    expect(changes).toEqual(["mapping ", "mapping survey:", "mapping survey:", "mapping survey:○ read pyproject.toml", "mapping survey:○ read pyproject.toml", "mapping "]);

    const state = newState(ROOT);
    state.areas.api = { id: "api", name: "api", about: "", paths: ["."], part: "api", features: [{ name: "a", title: "", about: "", paths: [] }, { name: "b", title: "", about: "", paths: [] }] };
    state.features["api#a"] = { key: "api#a", failed: "never held" };
    state.areas.web = { id: "web", name: "web", about: "", paths: ["web"], part: "web" };
    tracker.counted(state);
    expect(tracker.status.features).toEqual({ outlined: 2, done: 1 });
    expect(tracker.status.outlining).toBe(1);
    // A feature merged into another is never written: no longer among those to capture.
    state.divided = { api: { owns: { "api#a": "all of it" }, merged: { "api#b": { into: ["api#a"], why: "a slice of a" } } } };
    tracker.counted(state);
    expect(tracker.status.features).toEqual({ outlined: 1, done: 1 });

    tracker.stage("scripts", 2);
    tracker.worked();
    expect(tracker.status.work).toEqual({ done: 1, total: 2 });
    tracker.stage("writing");
    expect(tracker.status.work).toEqual({ done: 0, total: 0 });
  });
});

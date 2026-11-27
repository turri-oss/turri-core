import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testPlainFile, writePlain } from "../test-plain.ts";
import { DEFINITIONS, FUNCTIONAL_REQUIREMENTS, NON_FUNCTIONAL_REQUIREMENTS, TEST_REQUIREMENTS, type MarshalledPlainSource } from "../../src/plain/spec.ts";
import { createJobRegistry } from "../../src/regenerate/jobs.ts";
import { createWorkLoop, type JobRunner, type MapCodebase, type MapPlan, type MapPulse } from "../../src/regenerate/loop.ts";
import { recordHistory } from "../../src/regenerate/lineage.ts";
import { writeCodeRecord } from "../../src/regenerate/records.ts";
import { createSpecMapSource, defaultMapFiles, focusOf, importLabel, layOut, lineDiff, markSpecMap, pageItems, readSpecMap, rungOf, type MapItem, type MapPage, type MarkedPage } from "../../src/regenerate/spec-map.ts";

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turri-spec-map-"));
  cwd = process.cwd();
  process.chdir(dir);
  writeFileSync(join(dir, "config.yaml"), "conformance-tests: true\n");
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const item = (markdown: string) => ({ markdown });
/** A functional spec's func-id from its text: its first words but the filler - "A user can log in." is `log-in`. */
const funcIdOf = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word !== "" && !["a", "an", "the", "user", "can"].includes(word)).slice(0, 2).join("-");
/** A tree of the sections given; a functional spec is its text - its func-id taken from it - or [func-id, text]. */
const tree = (sections: Record<string, Array<string | [string, string]>>): MarshalledPlainSource =>
  Object.fromEntries(
    Object.entries(sections).map(([key, items]) => [
      key,
      items.map((entry) => (key === FUNCTIONAL_REQUIREMENTS ? (typeof entry === "string" ? { id: funcIdOf(entry), markdown: entry } : { id: entry[0], markdown: entry[1] }) : item(entry as string))),
    ]),
  );
const noPlan: MapPlan = { files: [], codebases: [] };

/** The page of one module built from `record`, its spec now `spec`. */
function page(spec: MarshalledPlainSource, record: MarshalledPlainSource | null, tested?: MarshalledPlainSource): MapPage {
  return { module: "app", plainFile: join(dir, "app.plain"), buildDir: join(dir, "code"), imports: [], items: pageItems({ module: "app", own: true, spec, record, tested: tested ?? null }) };
}

/** A pulse that regenerates the items given: from their record lines to their lines now. */
function pulseOf(items: MapItem[], number: number, running: boolean, title = `pulse ${number}`): MapPulse {
  const lines = (pick: (entry: MapItem) => string | undefined) => `["${FUNCTIONAL_REQUIREMENTS}"]\n${items.map(pick).filter((line) => line !== undefined).join("\n")}\n`;
  return { number, title, track: "code", running, rowId: running ? `job${number}` : `planned-app-${number}`, before: lines((entry) => entry.wasLine), after: lines((entry) => entry.line) };
}

const codebase = (first: MapPage, rest: Partial<MapCodebase> = {}): MapCodebase => ({ module: "app", plainFile: first.plainFile, buildDir: first.buildDir, pulses: [], conformance: true, ...rest });

describe("the regeneration from the files", () => {
  it("marks each item built, new or changed against the code record, and keeps an item taken out as a ghost in its place", () => {
    const items = page(
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- A user can register.", "- A user can log in with a password.", "- A user can post a photo."] }),
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- A user can register.", "- A user can search for others.", "- A user can log in with a passphrase."] }),
    ).items;
    expect(items.map((entry) => [entry.state, entry.text])).toEqual([
      ["built", "- A user can register."],
      ["removed", "- A user can search for others."],
      ["changed", "- A user can log in with a password."],
      ["new", "- A user can post a photo."],
    ]);
    expect(items[2]!.was).toBe("- A user can log in with a passphrase.");
  });

  it("shows a spec taken out only while the code still has it - one never built is simply gone", () => {
    const items = page(tree({ [FUNCTIONAL_REQUIREMENTS]: ["- A user can register."] }), tree({ [FUNCTIONAL_REQUIREMENTS]: ["- A user can register."] })).items;
    expect(items.map((entry) => entry.state)).toEqual(["built"]);
  });

  it("gives test reqs no build mark, and marks functional specs whose conformance tests are written as they read now, for an earlier text, or taken out", () => {
    const items = page(
      tree({ [TEST_REQUIREMENTS]: ["- Use pytest."], [FUNCTIONAL_REQUIREMENTS]: ["- Say hello.", "- Say goodbye loudly.", "- Count to three."] }),
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Say hello.", "- Say goodbye quietly.", "- Shout."] }),
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Say hello.", "- Say goodbye quietly.", "- Shout."] }),
    ).items;
    expect(items.find((entry) => entry.section === TEST_REQUIREMENTS)?.state).toBe("test");
    expect(items.filter((entry) => entry.section === FUNCTIONAL_REQUIREMENTS).map((entry) => [entry.text, entry.tests])).toEqual([
      ["- Say hello.", "now"],
      ["- Say goodbye loudly.", "older"],
      ["- Shout.", "removed"],
      ["- Count to three.", undefined],
    ]);
  });

  it("marks the conformance tests of a functional spec whose scenario changed as written for an earlier text - matched by its func-id", () => {
    const withScenario = (text: string): MarshalledPlainSource => ({ [FUNCTIONAL_REQUIREMENTS]: [{ id: "say-hello", markdown: "Say hello.", acceptance_tests: [{ id: "greets", text }] }] }) as MarshalledPlainSource;
    const record = tree({ [FUNCTIONAL_REQUIREMENTS]: [["say-hello", "Say hello."]] });
    const testsOf = (spec: MarshalledPlainSource) => page(spec, record, withScenario("It says hello.")).items.map((entry) => [entry.funcId, entry.tests]);
    expect(testsOf(withScenario("It says hello."))).toEqual([["say-hello", "now"]]);
    expect(testsOf(withScenario("It says hello loudly."))).toEqual([["say-hello", "older"]]);
  });

  it("marks the conformance tests of a functional spec regenerated again as written for an earlier build until they are written again", () => {
    const spec = tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Say hello.", "- Say goodbye."] });
    const tested: MarshalledPlainSource = { [FUNCTIONAL_REQUIREMENTS]: [{ id: "say-hello", markdown: "- Say hello.", regenerate_again: true }, { id: "say-goodbye", markdown: "- Say goodbye." }] };
    const items = page(spec, spec, tested).items.filter((entry) => entry.section === FUNCTIONAL_REQUIREMENTS);
    expect(items.map((entry) => [entry.text, entry.tests])).toEqual([
      ["- Say hello.", "older"],
      ["- Say goodbye.", "now"],
    ]);
  });

  it("lays the items out as the file has them: its sections in its order, its definitions in its order, then each imported file", () => {
    const items: MapItem[] = [
      { key: "1", section: DEFINITIONS, state: "built", text: "- :Zebra: is an animal.", acceptance: [] },
      { key: "2", section: DEFINITIONS, state: "built", text: "- :Apple: is a fruit.", acceptance: [] },
      { key: "3", section: NON_FUNCTIONAL_REQUIREMENTS, state: "built", text: "- Use Python 3.12.", acceptance: [] },
      { key: "4", section: FUNCTIONAL_REQUIREMENTS, state: "new", text: "- Eat an :Apple:.", acceptance: [] },
    ];
    const own = "***functional specs***\n\n# eat-an-apple\nEat an :Apple:.\n\n***definitions***\n\n- :Apple: is a fruit.\n\n- :Zebra: is an animal.\n";
    const lang = "***implementation reqs***\n\n- Use Python 3.12.\n";
    const laid = layOut(items, [{ text: own }, { label: "stdlib/lang/python", text: lang }]);
    expect(laid.map((entry) => [entry.text, entry.file])).toEqual([
      ["- Eat an :Apple:.", undefined],
      ["- :Apple: is a fruit.", undefined],
      ["- :Zebra: is an animal.", undefined],
      ["- Use Python 3.12.", "stdlib/lang/python"],
    ]);
  });

  it("names a standard library template by its import path, and a project's file from the project", () => {
    expect(importLabel("/opt/turri/stdlib/backend/python-fastapi.plain", "/work/app", "/opt/turri")).toBe("stdlib/backend/python-fastapi");
    expect(importLabel("/work/app/shared/common.plain", "/work/app")).toBe("shared/common");
  });

  it("reads a project before anything has run: what the code record has is built, the rest waits, and nobody has asked to build it", () => {
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n\n# say-goodbye\nSay goodbye.\n");
    const code = join(dir, "plain_modules", "app", "code");
    writeCodeRecord(code, { ...tree({ [NON_FUNCTIONAL_REQUIREMENTS]: ["- Use Python."] }), [FUNCTIONAL_REQUIREMENTS]: [{ id: "say-hello", linked_resources: [], markdown: "Say hello." }] });
    const [only] = markSpecMap(readSpecMap([join(dir, "app.plain")]), noPlan);
    expect(only!.items.map((entry) => [entry.mark, entry.text])).toEqual([
      ["built", "- Use Python."],
      ["built", "Say hello."],
      ["waiting", "Say goodbye."],
    ]);
    expect(only!.status).toBe("not asked to build - regenerate plans it");
  });

  it("says on a module's row which step of adding tests it skipped - the test reqs, then the script - and nothing where it has no scenarios", () => {
    const plain = (testReqs: boolean) =>
      `***implementation reqs***\n\n- Use Python.\n\n${testReqs ? "***test reqs***\n\n- Use pytest.\n\n" : ""}***functional specs***\n\n# say-hello\nSay hello.\n`;
    const row = () => markSpecMap(readSpecMap([join(dir, "app.plain")]), noPlan)[0]!;
    writePlain(dir, "app.plain", plain(false));
    expect(readSpecMap([join(dir, "app.plain")])[0]!.testingMissing).toBeUndefined();
    expect(row().status).toBe("not asked to build - regenerate plans it");
    // A scenario: its tests wait for the test reqs.
    mkdirSync(join(dir, "tests", "app"), { recursive: true });
    writeFileSync(join(dir, "tests", "app", "say-hello.plain"), testPlainFile("app", "say-hello", { conformance: ["# greets\nIt says hello."] }));
    expect(row().testingMissing).toBe("scenarios not tested: no test reqs");
    expect(row().status).toBe("not asked to build - regenerate plans it · scenarios not tested: no test reqs");
    // The test reqs: they wait for the conformance testing script.
    writePlain(dir, "app.plain", plain(true));
    expect(row().status).toBe("not asked to build - regenerate plans it · scenarios not tested: no conformance testing script");
    mkdirSync(join(dir, "test_scripts"), { recursive: true });
    writeFileSync(join(dir, "test_scripts", "run_conformance_tests_python.sh"), "#!/bin/sh\nexit 0\n");
    expect(row().testingMissing).toBeUndefined();
    expect(row().status).toBe("not asked to build - regenerate plans it");
  });

  it("has a page for each module of the requires chain, a module below read from the codebase built on it", () => {
    writePlain(dir, "base.plain", "***definitions***\n\n- :Store: is a key-value store.\n\n***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# put-a-value\nPut a value in the :Store:.\n");
    writePlain(dir, "top.plain", "---\nrequires:\n  - base\n---\n\n***implementation reqs***\n\n- Serve it over HTTP.\n\n***functional specs***\n\n# get-a-value\nGet a value back.\n");
    const code = join(dir, "plain_modules", "top", "code");
    writeCodeRecord(code, {
      [DEFINITIONS]: [{ markdown: "- :Store: is a key-value store.", module: "base" }],
      [NON_FUNCTIONAL_REQUIREMENTS]: [{ markdown: "- Use Python.", module: "base" }],
      "required functional specs": [{ id: "put-a-value", linked_resources: [], markdown: "Put a value in the :Store:.", module: "base" }],
    } as MarshalledPlainSource);
    writeFileSync(join(code, "main.py"), "");
    const pages = markSpecMap(readSpecMap([join(dir, "top.plain")]), noPlan);
    expect(pages.map((entry) => [entry.module, entry.buildDir, entry.items.map((each) => each.state)])).toEqual([
      ["base", code, ["built", "built", "built"]],
      ["top", code, ["new", "new"]],
    ]);
  });

  it("maps the project's module from config.yaml when nothing has been asked for, else the files no other one imports or requires", () => {
    writePlain(dir, "base.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# do-a-thing\nDo a thing.\n");
    writePlain(dir, "top.plain", "---\nrequires:\n  - base\n---\n\n***implementation reqs***\n\n- Serve it over HTTP.\n\n***functional specs***\n\n# do-another\nDo another.\n");
    expect(defaultMapFiles(dir)).toEqual([join(dir, "top.plain")]);
    writeFileSync(join(dir, "config.yaml"), "module: base.plain\n");
    expect(defaultMapFiles(dir)).toEqual([join(dir, "base.plain")]);
  });

  it("reads the files again only once a while has passed, or when asked to", () => {
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n");
    let at = 0;
    const source = createSpecMapSource({ files: () => [join(dir, "app.plain")], plan: () => noPlan, every: 1000, now: () => at });
    const specs = () => source.read()[0]!.items.filter((entry) => entry.section === FUNCTIONAL_REQUIREMENTS);
    expect(specs()).toHaveLength(1);
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n\n# say-goodbye\nSay goodbye.\n");
    at = 500;
    expect(specs()).toHaveLength(1);
    at = 1500;
    expect(specs()).toHaveLength(2);
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n");
    source.refresh();
    expect(specs()).toHaveLength(1);
  });
});

describe("the plan laid over the map", () => {
  const spec = tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in.", "- Follow someone.", "- Post a photo."] });
  const record = tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Search for others."] });

  it("marks the items of the running pulse regenerating and those planned with their pulse's number, the rest waiting", () => {
    const first = page(spec, record);
    const [login, follow] = [first.items.find((entry) => entry.text === "- Log in.")!, first.items.find((entry) => entry.text === "- Follow someone.")!];
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [pulseOf([login], 3, true), pulseOf([follow], 4, false)] })] });
    expect(marked!.items.map((entry) => [entry.text, entry.mark, entry.pulse?.number])).toEqual([
      ["- Register.", "built", undefined],
      ["- Search for others.", "waiting", undefined],
      ["- Log in.", "regenerating", 3],
      ["- Follow someone.", "planned", 4],
      ["- Post a photo.", "waiting", undefined],
    ]);
    // Planned and waiting alike are one mark - the top line says which.
    expect(marked!.items.map(rungOf)).toEqual(["regenerated", "takenOut", "working", "toRegenerate", "toRegenerate"]);
    expect(marked!.status).toBe("pulse 3 of 4 regenerating");
  });

  it("marks a ghost with the pulse that takes it out", () => {
    const first = page(spec, record);
    const search = first.items.find((entry) => entry.state === "removed")!;
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [pulseOf([search], 5, false)] })] });
    expect(marked!.items.find((entry) => entry.state === "removed")).toMatchObject({ mark: "planned", pulse: { number: 5 } });
  });

  it("marks what differs and has no pulse as being planned while the planner runs", () => {
    const first = page(spec, record);
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { planning: "code" })] });
    expect(marked!.items.filter((entry) => entry.state !== "built").every((entry) => entry.mark === "planning")).toBe(true);
    expect(marked!.status).toBe("planning");
  });

  it("marks the items of a pulse that did not land stuck and rolled back, the rest waiting, and says what the module needs the person for", () => {
    const first = page(spec, record);
    const login = first.items.find((entry) => entry.text === "- Log in.")!;
    const failed = pulseOf([login], 3, false);
    const [marked] = markSpecMap([first], {
      files: [],
      codebases: [codebase(first, { stuck: { why: `pulse abc ("log in") did not land - it runs again once the spec changes`, pulse: { number: 3, before: failed.before, after: failed.after } } })],
    });
    expect(marked!.items.find((entry) => entry.text === "- Log in.")).toMatchObject({ mark: "stuck", rolledBack: 3 });
    expect(marked!.items.find((entry) => entry.text === "- Follow someone.")!.mark).toBe("waiting");
    expect(marked!).toMatchObject({ status: "pulse 3 didn't land", stuck: true });
  });

  it("marks every item that differs stuck when the planner found no plan", () => {
    const first = page(spec, record);
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { stuck: { why: "the planner found no way to cut the work into pulses that hold together" } })] });
    expect(marked!.items.filter((entry) => entry.state !== "built").every((entry) => entry.mark === "stuck")).toBe(true);
    expect(marked!.status).toBe("the planner couldn't cut it into pulses");
  });

  it("says what went wrong in the pulse that did not land, when the loop knows", () => {
    const first = page(spec, record);
    const login = first.items.find((entry) => entry.text === "- Log in.")!;
    const failed = pulseOf([login], 3, false);
    const stuck = { why: `pulse abc ("log in") did not land - it runs again once the spec changes`, pulse: { number: 3, before: failed.before, after: failed.after }, cause: "its unit tests never passed" };
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { stuck })] });
    expect(marked!.status).toBe("pulse 3 didn't land - its unit tests never passed");
  });

  it("spins beside each functional spec a running conformance pulse writes tests for - its acceptance tests changed too", () => {
    const first = page(tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in."] }), tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in."] }));
    const spec = (markdown: string, id: string, tests: string[]) => JSON.stringify({ acceptance_tests: tests.map((text, index) => ({ id: `t${index + 1}`, text })), id, markdown });
    const conformance = (before: string[], after: string[], extra = ""): MapPulse => ({
      number: 2, title: "conformance", track: "conformance", running: true, rowId: "job2",
      before: `["${DEFINITIONS}"]\n${extra}["${FUNCTIONAL_REQUIREMENTS}"]\n${before.join("\n")}\n`,
      after: `["${DEFINITIONS}"]\n["${FUNCTIONAL_REQUIREMENTS}"]\n${after.join("\n")}\n`,
    });
    // Log in's acceptance scenario changed, its text did not: its tests are written again.
    const changed = conformance([spec("- Register.", "register", ["Signs up."]), spec("- Log in.", "log-in", ["Wrong password gives 401."])], [spec("- Register.", "register", ["Signs up."]), spec("- Log in.", "log-in", ["Wrong password gives 403."])]);
    let [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [changed] })] });
    expect(marked!.items.map((entry) => [entry.text, entry.testing === true])).toEqual([["- Register.", false], ["- Log in.", true]]);
    expect(marked!.items.map(rungOf)).toEqual(["regenerated", "validating"]);
    // The count is of all the module's pulses; what the running one does comes after it.
    expect(marked!.status).toBe("pulse 2 of 2 regenerating · conformance tests");
    // Only a definition changed: every one is tested again.
    const definitions = conformance([spec("- Register.", "register", ["Signs up."]), spec("- Log in.", "log-in", ["Logs in."])], [spec("- Register.", "register", ["Signs up."]), spec("- Log in.", "log-in", ["Logs in."])], `{"markdown":"- :User: is a person."}\n`);
    [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [definitions] })] });
    expect(marked!.items.every((entry) => entry.testing === true)).toBe(true);
  });

  it("knows the conformance pulse planned to write each functional spec's tests - planned from trees, or following the code still to build - and draws the spec regenerated, unnumbered", () => {
    const first = page(
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in.\n  - With a password.", "- Log out."] }),
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in.\n  - With a password.", "- Log out."] }),
    );
    const spec = (markdown: string, id: string) => JSON.stringify({ acceptance_tests: [{ id: "works", text: "It works." }], id, markdown });
    const planned: MapPulse = {
      number: 4, title: "app:register", track: "conformance", running: false, rowId: "planned-app-1",
      before: `["${FUNCTIONAL_REQUIREMENTS}"]\n`,
      after: `["${FUNCTIONAL_REQUIREMENTS}"]\n${spec("- Register.", "register")}\n`,
    };
    // Following the code still to build: no trees, its functional specs named module:func-id.
    const scheduled: MapPulse = { number: 12, title: "conformance tests", track: "conformance", running: false, rowId: "planned-app-2", before: "", after: "", specs: ["app:log-in"] };
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [planned, scheduled] })] });
    expect(marked!.items.map((entry) => [entry.text.split("\n")[0], entry.testsPulse?.number])).toEqual([["- Register.", 4], ["- Log in.", 12], ["- Log out.", undefined]]);
  });

  it("marks a test req from the conformance track: followed by the tests, being written for, or not yet - none where nothing is tested", () => {
    const spec = tree({ [TEST_REQUIREMENTS]: ["- Use pytest.", "- Run against the sandbox."], [FUNCTIONAL_REQUIREMENTS]: ["- Say hello."] });
    const record = tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Say hello."] });
    const reqs = (marked: MarkedPage) => marked.items.filter((entry) => entry.section === TEST_REQUIREMENTS).map((entry) => entry.mark);
    // No conformance test written anywhere: test reqs carry no mark.
    expect(reqs(markSpecMap([page(spec, record)], noPlan)[0]!)).toEqual(["none", "none"]);
    // The tests follow the first; the second waits for its conformance pulse - and, running, spins.
    const tested = tree({ [TEST_REQUIREMENTS]: ["- Use pytest."], [FUNCTIONAL_REQUIREMENTS]: ["- Say hello."] });
    const first = page(spec, record, tested);
    expect(reqs(markSpecMap([first], noPlan)[0]!)).toEqual(["built", "waiting"]);
    const pulse: MapPulse = {
      number: 3, title: "conformance", track: "conformance", running: true, rowId: "job3",
      before: `["${TEST_REQUIREMENTS}"]\n{"markdown":"- Use pytest."}\n`,
      after: `["${TEST_REQUIREMENTS}"]\n{"markdown":"- Use pytest."}\n{"markdown":"- Run against the sandbox."}\n`,
    };
    expect(reqs(markSpecMap([first], { files: [], codebases: [codebase(first, { pulses: [pulse] })] })[0]!)).toEqual(["built", "regenerating"]);
  });

  it("always shows the test reqs - as not used, and saying so once, where no functional spec of the module has scenarios", () => {
    const spec = tree({ [TEST_REQUIREMENTS]: ["- Use pytest.", "- Run in a container."], [FUNCTIONAL_REQUIREMENTS]: ["- Say hello."] });
    const unused = { ...page(spec, null), conformance: false };
    const [marked] = markSpecMap([unused], noPlan);
    const reqs = marked!.items.filter((entry) => entry.section === TEST_REQUIREMENTS);
    expect(reqs.map((entry) => [entry.mark, entry.unused])).toEqual([["none", true], ["none", true]]);
    // Used where one has scenarios: marked from the conformance track.
    expect(markSpecMap([{ ...page(spec, null), conformance: true }], noPlan)[0]!.items.filter((entry) => entry.section === TEST_REQUIREMENTS).every((entry) => entry.unused === undefined)).toBe(true);
  });

  it("says what a module waits for", () => {
    const first = page(spec, record);
    const [marked] = markSpecMap([first], { files: [], codebases: [codebase(first, { waitsFor: "base" })] });
    expect(marked!.status).toBe("waits for base");
  });
});

describe("the regeneration drawn", () => {
  it("opens the module regenerating now, and the one asked for, before the others", () => {
    const base = { ...page(tree({ [FUNCTIONAL_REQUIREMENTS]: ["- One."] }), null), module: "base", plainFile: join(dir, "base.plain") };
    const top = { ...page(tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Two."] }), null), module: "top", plainFile: join(dir, "top.plain") };
    // The chain's codebase is asked for: the module at its top is in focus.
    const asked = markSpecMap([base, top], { files: [], codebases: [codebase(base)] });
    expect(focusOf(asked)?.module).toBe("top");
    // A pulse regenerates the module below: that one is.
    const one = base.items[0]!;
    const regenerating = markSpecMap([base, top], { files: [], codebases: [codebase(base, { pulses: [pulseOf([one], 1, true)] })] });
    expect(focusOf(regenerating)?.module).toBe("base");
  });

  it("diffs a line word by word and an item line by line", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([{ was: "a", now: "a" }, { was: "b", now: "B" }, { was: "c", now: "c" }]);
  });
});

describe("the side panel's two views", () => {
  it("draws one mark a row on the ladder - planned, working, regenerated, validating, conform - the same whatever the config says of conformance tests, named in the legend in the corner", () => {
    const first = page(
      tree({ [DEFINITIONS]: ["- :User: is a person."], [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in.", "- Log out.", "- Search."] }),
      tree({ [DEFINITIONS]: ["- :User: is a person."], [FUNCTIONAL_REQUIREMENTS]: ["- Register.", "- Log in.", "- Log out."] }),
      tree({ [FUNCTIONAL_REQUIREMENTS]: ["- Register."] }),
    );
    const rungs = (conformance: boolean) => markSpecMap([{ ...first, conformance }], noPlan)[0]!.items.map((entry) => [entry.text, rungOf(entry)]);
    expect(rungs(true)).toEqual([
      ["- :User: is a person.", "regenerated"],
      ["- Register.", "conform"],
      ["- Log in.", "regenerated"],
      ["- Log out.", "regenerated"],
      ["- Search.", "toRegenerate"],
    ]);
    expect(rungs(false)).toEqual(rungs(true));
  });

  it("reads a plan that fails as a page saying so", () => {
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n");
    const source = createSpecMapSource({ files: () => [join(dir, "app.plain")], plan: () => { throw new Error("no plan"); } });
    expect(source.read()[0]).toMatchObject({ status: "the map could not be read: no plan", stuck: true });
  });
});

describe("the work loop's plan for the map", () => {
  it("numbers the module's pulses - the running one, then each planned one after it - with the trees each goes between", async () => {
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- :Implementation: is Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n\n# say-goodbye\nSay goodbye.\n");
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const run: JobRunner = async (job) => {
      await hold;
      mkdirSync(job.buildDir, { recursive: true });
      writeCodeRecord(job.buildDir, job.spec.tree);
      recordHistory(job.buildDir, job.planned.title);
      return { landed: true, report: "landed" };
    };
    const registry = createJobRegistry();
    const loop = createWorkLoop({ registry, cwd: dir, planner: false, run });
    await loop.bringUp("app.plain");
    // Planned from what the running one will land: the next look plans the rest.
    await loop.bringUp("app.plain");
    const plan = loop.mapPlan();
    expect(plan.files).toEqual([join(dir, "app.plain")]);
    const [only] = plan.codebases;
    expect(only!.pulses.map((pulse) => [pulse.number, pulse.title, pulse.running])).toEqual([
      [1, "Say hello.", true],
      [2, "Say goodbye.", false],
    ]);
    // The rows the pulse list shows them as.
    expect(only!.pulses[0]!.rowId).toBe(registry.list()[0]!.id);
    expect(loop.planned().map((row) => row.id)).toContain(only!.pulses[1]!.rowId);

    const [marked] = markSpecMap(readSpecMap(plan.files), plan);
    expect(marked!.items.filter((entry) => entry.section === FUNCTIONAL_REQUIREMENTS).map((entry) => [entry.text, entry.mark])).toEqual([
      ["Say hello.", "regenerating"],
      ["Say goodbye.", "planned"],
    ]);
    release();
    await loop.drain();
    const [done] = markSpecMap(readSpecMap(plan.files), loop.mapPlan());
    expect(done!.items.every((entry) => entry.mark === "built")).toBe(true);
    expect(done!.status).toBe("all built");
  });

  it("keeps a pulse that did not land with the halt, for the map to mark its items", async () => {
    writePlain(dir, "app.plain", "***implementation reqs***\n\n- Use Python.\n\n***functional specs***\n\n# say-hello\nSay hello.\n");
    const loop = createWorkLoop({ registry: createJobRegistry(), cwd: dir, planner: false, run: async () => ({ landed: false, report: "did not pass" }) });
    await loop.bringUp("app.plain");
    await loop.drain();
    const plan = loop.mapPlan();
    expect(plan.codebases[0]!.stuck).toMatchObject({ pulse: { number: 1 } });
    const [marked] = markSpecMap(readSpecMap(plan.files), plan);
    expect(marked!.items.find((entry) => entry.text === "Say hello.")).toMatchObject({ mark: "stuck", rolledBack: 1 });
    expect(marked!.status).toMatch(/^pulse 1 didn't land/);
  });
});

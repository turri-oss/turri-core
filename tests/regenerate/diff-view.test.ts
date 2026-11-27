import { describe, expect, it } from "vitest";
import { locateDiffLines } from "../../src/regenerate/diff-where.ts";

describe("line numbers in a spec diff", () => {
  // The diff is of the spec as read - what app.plain imports laid into it - so its own numbers are not the file's.
  const app = ["---", "import:", "  - common", "---", "", "***functional specs***", "", "- A :User: signs in.", ""].join("\n");
  const common = ["***definitions***", "", "- :User: is a person.", ""].join("\n");
  const spec = [
    "--- a/app.plain",
    "+++ b/app.plain",
    "@@ -1,5 +1,6 @@",
    " ***definitions***",
    " ",
    "-- :User: is someone.",
    "+- :User: is a person.",
    " ",
    " ***functional specs***",
    "+- A :User: signs in.",
    "",
  ].join("\n");
  const files = [
    { name: "app.plain", text: app },
    { name: "template/common.plain", text: common },
  ];

  it("places each added and unchanged line where it is written - its file, and its line there - and a removed line nowhere", () => {
    const where = locateDiffLines(spec, files);
    const lines = spec.split("\n");
    const at = (text: string) => where[lines.indexOf(text)];
    // Each with the section it is in, in its file.
    expect(at(" ***definitions***")).toEqual({ file: "template/common.plain", line: 1, section: "***definitions***", written: "***definitions***" });
    expect(at("+- :User: is a person.")).toEqual({ file: "template/common.plain", line: 3, section: "***definitions***", written: "- :User: is a person." });
    expect(at(" ***functional specs***")).toEqual({ file: "app.plain", line: 6, section: "***functional specs***", written: "***functional specs***" });
    expect(at("+- A :User: signs in.")).toEqual({ file: "app.plain", line: 8, section: "***functional specs***", written: "- A :User: signs in." });
    expect(at("-- :User: is someone.")).toBeUndefined();
  });
});

describe("placing a spec diff's lines in their files", () => {
  // The module's own definition with a link comes after a context line of a template it imports - as the spec reads.
  const common = { name: "template/crm_common.plain", text: "***definitions***\n\n- :Provider: is a CRM.\n" };
  const own = { name: "hubspot.plain", text: "***definitions***\n\n- :HubSpotMapping: is described in [resources/mapping.md](resources/mapping.md).\n" };
  const spec = ["--- a/hubspot.plain", "+++ b/hubspot.plain", "@@ -1,3 +1,5 @@", " - :Provider: is a CRM.", " ", "+- :HubSpotMapping: is described in `[resource]resources/mapping.md`.", ""].join("\n");

  it("finds a line with a link in the file it is written in - the link as the parser renders it - never in the template beside it", () => {
    const where = locateDiffLines(spec, [own, common]);
    expect(where[5]).toEqual({ file: "hubspot.plain", line: 3, section: "***definitions***", written: "- :HubSpotMapping: is described in [resources/mapping.md](resources/mapping.md)." });
  });

  it("says how a nested line with a link is written in its file - the link as written, not as the diff reads it - so a host finds it again", () => {
    const nested = {
      name: "tasks.plain",
      text: "***definitions***\n\n- :TaskList: is the page of tasks.\n  - It is described in [resources/task list ui.yaml](resources/task list ui.yaml).\n  - It looks as [resources/shot.png](resources/shot.png) shows.\n",
    };
    const diff = [
      "--- a/tasks.plain",
      "+++ b/tasks.plain",
      "@@ -1,2 +1,5 @@",
      " ***definitions***",
      " ",
      "+- :TaskList: is the page of tasks.",
      "+  - It is described in `[resource]resources/task list ui.yaml`.",
      "+  - It looks as `[resource]resources/shot.png` shows.",
      "",
    ].join("\n");
    const where = locateDiffLines(diff, [nested]);
    expect(where[6]).toEqual({ file: "tasks.plain", line: 4, section: "***definitions***", written: "  - It is described in [resources/task list ui.yaml](resources/task list ui.yaml)." });
    expect(where[7]).toEqual({ file: "tasks.plain", line: 5, section: "***definitions***", written: "  - It looks as [resources/shot.png](resources/shot.png) shows." });
  });

  it("says a linked resource's content changed - which item links it, in which file, and its new hash", async () => {
    const { resourceDiff } = await import("../../src/regenerate/spec-steps.ts");
    const item = (digest: string) => JSON.stringify({ markdown: "- :HubSpotMapping: is described in `[resource]resources/mapping.md`.", linked_resources: [{ digest, target: "resources/mapping.md", text: "resources/mapping.md" }] });
    const resource = resourceDiff([{ id: "1", section: "definitions", kind: "change", before: item("a1"), after: item("b2"), position: 1 }], "hubspot.plain");
    expect(resource).toContain("+resources/mapping.md, linked by :HubSpotMapping: in hubspot.plain: its content changed, sha256 b2");
  });
});

describe("placing a test plain file's lines", () => {
  it("places the lines under a test plain file's header in that file alone, never in the module's frontmatter or another test plain file", () => {
    const module = { name: "shorty.plain", text: "---\nimport:\n  - stdlib/backend/python-fastapi\n---\n\n***functional specs***\n\n# create-link\nCreates a link.\n" };
    const testFile = (funcId: string, scenario: string) => ({
      name: `tests/shorty/${funcId}.plain`,
      text: `---\nmodule: shorty\nfunc_id: ${funcId}\n---\n\n***conformance tests***\n\n# ${scenario}\nIt works.\n\n***acceptance tests***\n`,
    });
    const files = [module, testFile("service-info", "get-root"), testFile("create-link", "creates")];
    const diff = [
      "diff --git a/tests/shorty/create-link.plain b/tests/shorty/create-link.plain",
      "--- a/tests/shorty/create-link.plain",
      "+++ b/tests/shorty/create-link.plain",
      "@@ -0,0 +1,11 @@",
      ...files[2]!.text.replace(/\n$/, "").split("\n").map((line) => `+${line}`),
    ].join("\n");
    const where = locateDiffLines(diff, files);
    const placed = Object.values(where);
    expect(placed.every((at) => at.file === "tests/shorty/create-link.plain")).toBe(true);
    expect(where[4]).toMatchObject({ file: "tests/shorty/create-link.plain", line: 1 });
    expect(where[6]).toMatchObject({ file: "tests/shorty/create-link.plain", line: 3 });
  });
});

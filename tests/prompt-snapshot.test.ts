import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the model reads from turri - each chat's system prompt and the tools it is given - in a terminal's chats and a
 * host's, written out as files. A change to any of it shows as a diff of those files, to be meant or not: the snapshot
 * is the record of what an agent was told, kept while the session's interface is reshaped around it.
 */

vi.mock("../src/regenerate/diagnose.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/regenerate/diagnose.ts")>()),
  diagnoseFailure: async () => undefined,
}));

// What the model is told of this machine is the machine's own: the snapshot is of one with Seatbelt up and every
// language of the standard library installed, whichever machine - CI's Linux among them - runs it.
vi.mock("../src/regenerate/os-sandbox.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/regenerate/os-sandbox.ts")>()),
  sandboxAvailable: () => ({ kind: "seatbelt" }),
}));
vi.mock("../src/stack.ts", async (importOriginal) => {
  const stack = await importOriginal<typeof import("../src/stack.ts")>();
  return { ...stack, toolchainsBlock: () => stack.toolchainsBlock(() => true) };
});

const { createTurriCore, chatRulesBlock } = await import("../src/extension.ts");
const { PACKAGE_ROOT } = await import("../src/regenerate/paths.ts");

let project: string;
let before: string;
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "turri-prompts-")));
  writeFileSync(join(project, "config.turri.yaml"), "conformance-tests: false\n");
  before = process.cwd();
  process.chdir(project);
});
afterEach(() => {
  process.chdir(before);
  rmSync(project, { recursive: true, force: true });
});

type Handler = (event: unknown, ctx: unknown) => unknown;
type Tool = { name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: unknown; parameters?: unknown };

/** pi as a chat's extension is built into it: the tools and handlers kept, nothing else done. */
function recordingPi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, Handler[]>();
  const pi = new Proxy({}, {
    get: (_target, key) => {
      if (key === "registerTool") return (tool: Tool) => void tools.set(tool.name, tool);
      if (key === "on") return (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    },
  }) as never;
  return { pi, tools, handlers };
}

const contextOf = () => ({ hasUI: true, cwd: project, model: undefined, sessionManager: { getBranch: () => [], getEntries: () => [] }, ui: { notify: () => {}, setWorkingMessage: () => {} } });

/** The text with what differs between machines and runs put as names: the project, turri's folder, the home folder. */
function normalised(text: string): string {
  return text
    .replaceAll(chatRulesBlock(), "<the ***plain rules>")
    .replaceAll(project, "<project>")
    .replaceAll(PACKAGE_ROOT, "<turri-core>")
    .replaceAll(homedir(), "<home>");
}

/** The system prompt a turn of the chat is sent, as pi asks each before_agent_start handler in turn. */
async function systemPromptOf(handlers: Map<string, Handler[]>): Promise<string> {
  const event = { systemPrompt: "<pi's own system prompt>", systemPromptOptions: { skills: [] as unknown[] } };
  for (const handler of handlers.get("before_agent_start") ?? []) {
    const result = (await handler(event, contextOf())) as { systemPrompt?: string } | undefined;
    if (result?.systemPrompt !== undefined) event.systemPrompt = result.systemPrompt;
  }
  return event.systemPrompt;
}

function toolsText(tools: Map<string, Tool>): string {
  return [...tools.values()]
    .map((tool) => JSON.stringify({ name: tool.name, label: tool.label, description: tool.description, promptSnippet: tool.promptSnippet, promptGuidelines: tool.promptGuidelines, parameters: tool.parameters }, null, 2))
    .join("\n");
}

/** The terminal's own words for where the person watches the work - what turri's CLI says as its surface. */
const TERMINAL_SURFACE = [
  "regen is the side panel (ctrl+h): the spec with each functionality and item marked built, regenerating, planned or",
  "waiting - and behind it the pulses (/pulses), every pulse regenerating, planned and finished. Say regen, lowercase. It",
  "was the regeneration, the job queue, or the job panel. Finished pulses, the sentinel's conclusions and its notices go",
  "to the notification centre (/notifications).",
].join("\n");

/** Two front ends: the terminal's, and a host's - each with its own words, each showing pulse ends and notices itself. */
const SHAPES = {
  terminal: { host: { surface: TERMINAL_SURFACE, pulseEndsShown: true, noticesShown: true } },
  host: { host: { surface: "<the host's own words for its views>", pulseEndsShown: true, noticesShown: true } },
} as const;

describe("what the model reads", () => {
  for (const [shape, { host }] of Object.entries(SHAPES)) {
    it(`in a ${shape}'s chat and its sentinel`, async () => {
      const session = createTurriCore(host, {});
      const chats: Array<ReturnType<typeof recordingPi>> = [];
      session.setDriver({
        create: async () => {
          const made = recordingPi();
          chats.push(made);
          await session.extension(made.pi);
        },
        dispose: async () => {},
      });
      try {
        await session.open();
        await session.open({ hidden: true, role: "sentinel" });
        const [person, sentinel] = chats;
        for (const [role, chat] of [["chat", person!], ["sentinel", sentinel!]] as const) {
          await expect(normalised(await systemPromptOf(chat.handlers))).toMatchFileSnapshot(`./__snapshots__/prompts/${shape}-${role}.prompt.txt`);
          await expect(normalised(toolsText(chat.tools))).toMatchFileSnapshot(`./__snapshots__/prompts/${shape}-${role}.tools.txt`);
        }
      } finally {
        await session.dispose();
      }
    });
  }
});

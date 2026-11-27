import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ChatLink, TurriCore } from "./chats.ts";
import { appendChatEntry, sendChatMessage, NOTICE_ENTRY, NOTICE_OVER_ENTRY, CONCLUDED_ENTRY } from "./chat-entries.ts";
import { projectModels, readProjectConfig, roleModel } from "./config.ts";
import { concludedNote, concludeTool, keepGuidanceTool, notifyTool, resumeTool, sentinelFileTools, whoHoldsTool, type Conclusion, type Notice } from "./sentinel.ts";

/**
 * The sentinel in a chat: its tools in place of the chat's - the project to read, its shell behind the walls, notices,
 * its guidance, a host's own - its model, and, in every chat, the notices it puts to the person: a card in the chat and,
 * in the terminal, a dialog once the chat is idle (docs/sentinel.md).
 */

/** A notice in the transcript: the card. */
export { NOTICE_ENTRY };
/** A notice's end, under its card: answered, dismissed, superseded by a newer one about its module. */
export { NOTICE_OVER_ENTRY };
/** The sentinel done with a pulse, in the chat the person is in. */
export { CONCLUDED_ENTRY };

const IGNORE = "Ignore - leave it as the build has it";
const STEER = "Say what to do instead…";
const DISMISS = "Dismiss";

/** The sentinel's tools and model, built into its chat. */
export function registerSentinel(pi: ExtensionAPI, session: TurriCore, cwd: string, hostTools: ToolDefinition[], allowed: Set<string>, resume: (plainFile: string) => Promise<string>): void {
  // pi's own file tools and shell, replaced by fenced ones of the same names: the whole project to read, nothing to write.
  for (const tool of sentinelFileTools(cwd)) pi.registerTool(tool);
  pi.registerTool(
    notifyTool((input) => {
      const job = input.job !== undefined ? session.jobs.get(input.job) : undefined;
      const module = input.module ?? job?.module;
      return session.notice({ ...input, ...(module !== undefined ? { module } : {}), ...(job?.pulse !== undefined ? { pulse: job.pulse } : {}) });
    }),
  );
  pi.registerTool(concludeTool((conclusion) => session.concluded(conclusion)));
  pi.registerTool(keepGuidanceTool(cwd));
  pi.registerTool(whoHoldsTool(cwd));
  pi.registerTool(resumeTool(resume));
  for (const tool of hostTools) pi.registerTool(tool);

  // Only its tools are offered to its model; what it calls besides is refused (extension.ts, tool_call).
  let modelSet = false;
  pi.on("session_start", async (_event, ctx) => {
    try {
      pi.setActiveTools(pi.getAllTools().map((tool) => tool.name).filter((name) => allowed.has(name)));
    } catch {
      /* a session let go has no tools to set */
    }
    // Its model, once: the `sentinel` role's, else the chat's - never the one its session started on, which in a host is
    // pi's default and may not be the project's provider's. What the person then picks in its chat stands.
    if (modelSet) return;
    modelSet = true;
    const config = readProjectConfig(cwd);
    const choice = roleModel(config, "sentinel") ?? projectModels(config).harness;
    if (choice?.model !== undefined) {
      const slash = choice.model.indexOf("/");
      const found = slash === -1 ? undefined : ctx.modelRegistry.find(choice.model.slice(0, slash), choice.model.slice(slash + 1));
      if (found !== undefined) await pi.setModel(found);
    }
    if (choice?.thinking !== undefined) pi.setThinkingLevel(choice.thinking);
  });
}

/**
 * The terminal's question whether to start the sentinel: the sentence, and how to switch to it - it opens last in the
 * strip, after the `open` chats there are. A host has its own way to it, and is given the sentence alone.
 */
export function startTitle(notice: Notice, open: number): string {
  return `${notice.summary}\nUse "/chat ${open + 1}" to open the sentinel.`;
}

/**
 * A chat's notices: each drawn as a card, and - with no host to answer it - put to the person as a dialog once the chat
 * is idle, one at a time: an action accepted, their own words, or dismissed. A notice that is over closes its dialog.
 */
export function noticeDialogs(
  pi: ExtensionAPI,
  session: TurriCore,
  link: ChatLink,
  context: () => ExtensionContext | undefined,
): { put(notice: Notice): void; over(notice: Notice): void; concluded(conclusion: Conclusion): void } {
  const waiting: Notice[] = [];
  const asking = new Map<string, AbortController>();
  let open = false;

  const ask = async (): Promise<void> => {
    if (open || link.session()?.isStreaming === true) return;
    const notice = waiting.shift();
    if (notice === undefined) return;
    if (notice.state !== "open") return ask();
    const ctx = context();
    if (ctx === undefined || !ctx.hasUI) {
      waiting.unshift(notice);
      return;
    }
    open = true;
    const controller = new AbortController();
    asking.set(notice.id, controller);
    try {
      // Whether to start the sentinel is turri's question, its answers its own: no words of the person's to act on.
      const starting = notice.kind === "sentinel-start";
      const options = [
        ...notice.actions.map((action, index) => `${index + 1}. ${action.label}`),
        ...(notice.ignorable === true ? [IGNORE] : []),
        ...(starting ? [] : [STEER]),
        DISMISS,
      ];
      const picked = await ctx.ui.select(starting ? startTitle(notice, session.chats().length) : `sentinel: ${notice.summary}`, options, { signal: controller.signal });
      if (controller.signal.aborted || notice.state !== "open") return;
      if (picked === STEER) {
        const words = await ctx.ui.input("What should be done about it?", "", { signal: controller.signal });
        if (controller.signal.aborted || notice.state !== "open") return;
        if (words === undefined || words.trim() === "") waiting.unshift(notice);
        else session.answer(notice.id, { steer: words });
        return;
      }
      if (picked === IGNORE) {
        session.answer(notice.id, { ignore: true });
        return;
      }
      const index = options.indexOf(picked ?? DISMISS);
      session.answer(notice.id, index >= 0 && index < notice.actions.length ? { action: index } : { dismiss: true });
    } catch {
      /* a dialog the chat lost - let go, or rebuilt - leaves the notice for the next */
    } finally {
      asking.delete(notice.id);
      open = false;
      void ask();
    }
  };
  pi.on("agent_settled", () => void ask());

  return {
    put(notice) {
      if (session.terminal) return; // The terminal centre received it, including the question whether to start.
      try {
        appendChatEntry(pi, NOTICE_ENTRY, notice);
      } catch {
        /* the host still hears of it */
      }
      // A host answers it itself: its card, its buttons. A note of a fix the sentinel made asks nothing: its card alone.
      if (session.host.onNotice !== undefined || notice.kind === "fixed") return;
      waiting.push(notice);
      void ask();
    },
    concluded(conclusion) {
      try {
        if (!session.terminal) appendChatEntry(pi, CONCLUDED_ENTRY, conclusion);
      } catch {
        /* the agent is still told */
      }
      // A host that shows the person the conclusion itself: the chat knows of it - in order, with no turn of its own.
      const shown = session.terminal || session.host.pulseEndsShown === true;
      sendChatMessage(pi,
        {
          customType: "turri_sentinel_concluded",
          content: concludedNote(conclusion, { shown }),
          display: false,
          details: { ...(conclusion.job !== undefined ? { jobId: conclusion.job } : {}), ...(conclusion.check !== undefined ? { checkId: conclusion.check } : {}), verdict: conclusion.verdict },
        },
        shown ? { triggerTurn: false } : { triggerTurn: true, deliverAs: "followUp" },
      );
    },
    over(notice) {
      if (session.terminal) return;
      asking.get(notice.id)?.abort();
      const at = waiting.indexOf(notice);
      if (at !== -1) waiting.splice(at, 1);
      try {
        appendChatEntry(pi, NOTICE_OVER_ENTRY, { state: notice.state, summary: notice.summary });
      } catch {
        /* a chat let go says nothing */
      }
    },
  };
}

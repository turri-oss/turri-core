import { describe, expect, it } from "vitest";
import { DECLINED, OTHER_OPTION } from "../src/ask.ts";
import { askUserVia, chatAskUserTool } from "../src/extension.ts";
import type { QuestionView } from "../src/view.ts";

/** What a dialog was given: its question, its options, and what it shows above the question. */
type Shown = { title: string; options?: string[]; context?: string };

/** ctrl+c at a dialog: the person declines the question. */
const CTRL_C = "\x03";

/**
 * A view's dialogs (TurriView.questions) as turri's terminal puts a question - each one asked for opened, closed from
 * outside - each kept with what it was given and answered with what `press` gives it: an option, ctrl+c, or nothing at
 * all. By default, the first option. It opens a dialog even for a question declined already: that none is asked for
 * then is turri's to keep (askUserVia), not the view's.
 */
function fakeUi(press: (shown: Shown) => string | undefined = (shown) => shown.options?.[0]) {
  const shown: Shown[] = [];
  const questions: QuestionView = {
    dialogs: (_ctx, declining, decline) => {
      const dialog = (title: string, context: string | undefined, options?: string[]) =>
        new Promise<string | undefined>((resolve) => {
          const one: Shown = { title, ...(options !== undefined ? { options } : {}), ...(context !== undefined ? { context } : {}) };
          shown.push(one);
          declining.close = () => resolve(undefined);
          const key = press(one);
          if (key === CTRL_C) decline();
          else if (key !== undefined) resolve(key);
        });
      return { select: (title, options, context) => dialog(title, context, options), input: (title, context) => dialog(title, context) };
    },
  };
  const ui = { setWorkingMessage: () => {}, setWidget: () => {} };
  return { ctx: { hasUI: true, ui }, shown, questions };
}

describe("ask_user in the conversation", () => {
  it("puts the question to the person as a dialog to pick from, and returns what they picked", async () => {
    const { ctx, shown, questions } = fakeUi((asked) => asked.options?.[1]);
    const tool = chatAskUserTool(undefined, undefined, questions);
    const result = await (tool.execute as (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>)(
      "id",
      { question: "Which CRM first?", options: ["HubSpot", "Salesforce"] },
      undefined,
      undefined,
      ctx,
    );
    expect(shown[0]!.title).toBe("Which CRM first?");
    expect(shown[0]!.options).toEqual(expect.arrayContaining(["HubSpot", "Salesforce"]));
    expect(result.content[0]!.text).toContain("Salesforce");
    expect(tool.promptGuidelines!.some((line) => line.includes("rather than in your reply"))).toBe(true);
  });

  it("shows a skill's question alone - what its agent said before it kept in its record, never in the dialog", async () => {
    const { ctx, shown, questions } = fakeUi();
    const kept: Array<string | undefined> = [];
    const said = "The configured token returned **200**; the invalid token returned **401**.";
    const answer = await askUserVia(ctx as never, (_question, _answer, context) => kept.push(context), undefined, undefined, questions)({
      question: "Which authentication setup should HubSpot contact sync use?",
      options: ["Private app token"],
      said,
    });
    expect(answer).toBe("Private app token");
    expect(shown[0]!.title).toBe("Which authentication setup should HubSpot contact sync use?");
    expect(shown[0]!.context).toBeUndefined();
    expect(JSON.stringify(shown[0])).not.toContain("returned");
    expect(kept).toEqual([said]);
  });

  it("shows above a skill's question what it gives to read for it - the brief to confirm - and keeps it with the answer", async () => {
    const { ctx, shown, questions } = fakeUi();
    const kept: Array<string | undefined> = [];
    const brief = "- Problem: invoices get lost.\n- Primary user: a freelancer.";
    await askUserVia(ctx as never, (_question, _answer, context) => kept.push(context), undefined, undefined, questions)({
      question: "Is this the right brief?",
      options: ["Yes"],
      context: brief,
      said: "Here is what I have.",
    });
    expect(shown[0]).toMatchObject({ title: "Is this the right brief?", context: brief });
    expect(kept).toEqual([`${brief}\n\nHere is what I have.`]);
  });
});

describe("ctrl+c at a question", () => {
  /** A chat's context mid-turn: its turn's signal, and whether it was stopped. */
  const inTurn = (press: (shown: Shown) => string | undefined) => {
    const { ctx, shown, questions } = fakeUi(press);
    const turn = new AbortController();
    let stopped = 0;
    const context = { ...ctx, signal: turn.signal, abort: () => ((stopped += 1), turn.abort()) };
    return { ctx: context, shown, questions, turn, stopped: () => stopped };
  };

  it("declines the question - no other dialog for it - and leaves the turn running", async () => {
    const { ctx, shown, questions, stopped } = inTurn(() => CTRL_C);
    const kept: string[] = [];
    const answer = await askUserVia(ctx as never, (_question, answered) => kept.push(answered), undefined, undefined, questions)({ question: "Which stack?", options: ["Flask", "Django"], multiSelect: true });
    expect(answer).toBe(DECLINED);
    expect(shown).toHaveLength(1);
    expect(kept).toEqual([DECLINED]);
    expect(stopped()).toBe(0);
  });

  it("declines the question at the dialog for typing an answer instead - its options not put again", async () => {
    let selects = 0;
    const { ctx, shown, questions, stopped } = inTurn((asked) => {
      if (asked.options === undefined) return CTRL_C;
      selects += 1;
      return selects === 1 ? OTHER_OPTION : asked.options[0];
    });
    const answer = await askUserVia(ctx as never, () => {}, undefined, undefined, questions)({ question: "Which stack?", options: ["Flask", "Django"] });
    expect(answer).toBe(DECLINED);
    expect(shown.map((one) => (one.options !== undefined ? "options" : "typed"))).toEqual(["options", "typed"]);
    expect(stopped()).toBe(0);
  });

  it("opens none of the view's dialogs once declined at its dialog for typing - though the view opens every one asked for, and gives back what was typed there", async () => {
    // A view that guards nothing: ctrl+c at its dialog for typing declines the question, and the dialog gives back what
    // was typed all the same - a side question, after which the question is put again - and it opens every dialog asked
    // for, declined or not. That none opens after the decline is turri's to keep.
    const askedOf = async (request: { question: string; options?: string[]; freeForm?: boolean }) => {
      const opened: string[] = [];
      let typed = 0;
      const questions: QuestionView = {
        dialogs: (_ctx, _declining, decline) => ({
          select: async (_title, options) => {
            opened.push("options");
            return opened.length === 1 ? OTHER_OPTION : options[0];
          },
          input: async () => {
            opened.push("typed");
            typed += 1;
            decline();
            return typed === 1 ? "/btw what is a stack?" : undefined;
          },
        }),
      };
      const answer = await askUserVia(fakeUi().ctx as never, () => {}, async () => "What the code is built on.", undefined, questions)(request);
      return { answer, opened };
    };
    // Typed with no options: put again, the question would open the dialog for typing.
    expect(await askedOf({ question: "Which stack?", freeForm: true })).toEqual({ answer: DECLINED, opened: ["typed"] });
    // Typed instead of picked: put again, it would open its options.
    expect(await askedOf({ question: "Which stack?", options: ["Flask", "Django"] })).toEqual({ answer: DECLINED, opened: ["options", "typed"] });
  });

  it("declines every question it is pressed at, however many in a row, the turn going on", async () => {
    const { ctx, questions, stopped } = inTurn(() => CTRL_C);
    const ask = askUserVia(ctx as never, () => {}, undefined, undefined, questions);
    for (const question of ["Which stack?", "Which database?", "Which host?", "Which auth?", "Which CI?"]) {
      expect(await ask({ question, options: ["The first"] })).toBe(DECLINED);
    }
    expect(stopped()).toBe(0);
  });

  it("closes the question open when its turn is stopped", async () => {
    const { ctx, questions, turn } = inTurn(() => undefined);
    const asked = askUserVia(ctx as never, () => {}, undefined, undefined, questions)({ question: "Which stack?", options: ["Flask"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    turn.abort();
    expect(await asked).toBe(DECLINED);
  });

  it("ends a question in a host's dialog when its turn is stopped", async () => {
    const turn = new AbortController();
    const never = () => new Promise<undefined>(() => {});
    const asked = askUserVia({ hasUI: false, signal: turn.signal } as never, () => {}, undefined, { select: never, input: never })({ question: "Ship it?", options: ["Yes"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    turn.abort();
    expect(await asked).toBe(DECLINED);
  });
});

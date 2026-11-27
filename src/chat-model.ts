import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { splitModelSpec } from "./config.ts";

/**
 * A person's chat runs on harness-model, as turri starts pi with it: put on it as the chat starts, and again whenever
 * harness-model changes - read from the project's config each time, so a chat opened after a change starts on the new
 * one. A model the person chooses in a chat holds until harness-model changes again.
 *
 * While harness-model cannot be reached here - no such model, or its provider not signed in - the chat sends nothing to a
 * model: pi's own choice instead would be the first provider with credentials, an AWS account the person's shell has,
 * say, billed there unseen. It is said, and the front end hears it, until a sign-in or a change to harness-model puts the
 * chat on a model it can reach. The sentinel's chat is not one of these: its model is models.sentinel.
 */

/** harness-model as a chat cannot be on it: the model, its provider, and why - no such model here, or not signed in. */
export interface ModelOutOfReach {
  /** The model, provider/model-id. */
  model: string;
  provider: string;
  why: "unknown" | "signed-out";
}

/** A model of pi's registry. */
type Model = NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;

export interface HarnessFollower {
  /** Put the chat on harness-model if it is not on it as the config has it now, or say why it cannot be. */
  check(ctx: ExtensionContext): Promise<void>;
  /** harness-model as it cannot be reached now - none while the chat is on it, or harness-model is unset. */
  outOfReach(): ModelOutOfReach | undefined;
}

export function followHarnessModel(options: {
  /** harness-model as the config has it now: provider/model-id[:thinking], or none. */
  wanted: () => string | undefined;
  setModel: (model: Model) => Promise<boolean>;
  setThinking: (level: string) => void;
  /** What cannot be reached now changed: none once it can be. */
  changed: (outOfReach: ModelOutOfReach | undefined) => void;
}): HarnessFollower {
  /** The harness-model the chat was last put on: until it changes, a model the person chose holds. */
  let settled: string | undefined;
  let outOfReach: ModelOutOfReach | undefined;
  const reach = (now: ModelOutOfReach | undefined) => {
    if (JSON.stringify(now) === JSON.stringify(outOfReach)) return;
    outOfReach = now;
    options.changed(now);
  };
  return {
    async check(ctx) {
      const wanted = options.wanted() ?? "";
      const { model, thinking } = splitModelSpec(wanted);
      // Unset, or a thinking level alone: pi's own choice of model, as turri has it.
      if (model === undefined) {
        if (thinking !== undefined && settled !== wanted) options.setThinking(thinking);
        settled = wanted;
        return reach(undefined);
      }
      if (settled === wanted && outOfReach === undefined) return;
      const slash = model.indexOf("/");
      const provider = slash > 0 ? model.slice(0, slash) : model;
      let found: Model | undefined;
      let signedIn = false;
      try {
        found = slash > 0 ? ctx.modelRegistry.find(provider, model.slice(slash + 1)) : undefined;
        signedIn = found !== undefined && ctx.modelRegistry.hasConfiguredAuth(found);
      } catch {
        /* a registry let go: as if there were no such model */
      }
      if (found === undefined || !signedIn) {
        settled = undefined;
        return reach({ model, provider, why: found === undefined ? "unknown" : "signed-out" });
      }
      const on = ctx.model;
      if (on === undefined || on.provider !== found.provider || on.id !== found.id) {
        if (!(await options.setModel(found))) {
          settled = undefined;
          return reach({ model, provider, why: "signed-out" });
        }
      }
      if (thinking !== undefined) options.setThinking(thinking);
      settled = wanted;
      reach(undefined);
    },
    outOfReach: () => outOfReach,
  };
}

/** What the person is told when a message is not sent: harness-model out of reach, and what to do about it. */
export function outOfReachText(outOfReach: ModelOutOfReach): string {
  const why =
    outOfReach.why === "unknown"
      ? `there is no model ${outOfReach.model} here - check harness-model in config.turri.yaml, or the provider's extension`
      : `${outOfReach.provider} is not signed in - sign in to it, or choose another harness-model with /settings`;
  return `Nothing was sent: ${outOfReach.model}, the model this project talks to, cannot be reached - ${why}.`;
}

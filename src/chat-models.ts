/**
 * The two models of `turri`, from its arguments and the project's config.turri.yaml.
 *
 * The harness model is the one the person talks to: pi's own `--model`, which `--harness-model`
 * is another name for, or else `harness-model:` in config.turri.yaml. The coding model is the one
 * every render runs on: `--coding-model`, or else `coding-model:` in config.turri.yaml - pi knows
 * nothing of it, so it reaches the extension through the environment. Either can still be
 * changed in the conversation: pi's /model, and the settings tool or /settings for the coding model.
 */

/** The environment variable a chat's --coding-model reaches the extension through. */
export const CODING_MODEL_ENV = "TURRI_CODING_MODEL";

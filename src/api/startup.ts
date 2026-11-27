/** Before pi loads: check the runtime, identify the CLI and select the models and themes for this invocation. */
export { checkNode } from "../node-check.ts";
export { setTurriRoot, turriRoot, versionLine, themeFiles, extensionInstalledGlobally, themesInstalledGlobally, globalExtensionFile } from "../environment.ts";
export { describeVersion } from "../turri-versions.ts";
export { readProjectConfig, modelSpec, projectModels } from "../config.ts";
export { dropNoise } from "../quiet.ts";
export { CODING_MODEL_ENV } from "../chat-models.ts";
export { REOPEN_FILE_ENV, takeReopening } from "../reopen.ts";

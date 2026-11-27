/**
 * `@turri-dev/core/models`: the models turri runs on - each vendor's pair, Amazon Bedrock's makers and geographies, pi's
 * catalogue of models, model specs as config.turri.yaml writes them - and the providers signed in to.
 */
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/** pi's id for this machine, as a provider's sign-in asks for it. */
export function loginDeviceId(cwd: string, agentDir = getAgentDir()): string {
  return SettingsManager.create(cwd, agentDir).getOrCreateDeviceId();
}

export { modelSpec, projectModels, splitModelSpec, THINKING_LEVELS, type ModelChoice, type ThinkingLevel } from "../config.ts";
export { bedrockRegionFor, type BedrockRegion, type BedrockRegionSource } from "../bedrock-region.ts";
export {
  BEDROCK_DEFAULT,
  BEDROCK_GEOGRAPHIES,
  BEDROCK_IN_REGION,
  BEDROCK_REGIONS,
  bedrockAwsRegion,
  bedrockDefaultModels,
  bedrockMakerOf,
  bedrockMakers,
  bedrockModels,
  bedrockModelsIn,
  bedrockNeedsAwsRegion,
  bedrockPlaceOf,
  bedrockRegionOf,
  hasPreset as hasBedrockPreset,
  makerLabel,
  priced,
  vendorOf,
  VENDORS,
  type BedrockChoice,
  type BedrockMaker,
  type BedrockOffer,
  type ModelSet,
  type PresetMaker,
  type Vendor,
  type VendorPreset,
} from "../init-config.ts";
export type { AgentRole, ProjectConfig, RoleChoice, SentinelSetting } from "../config.ts";
export { AGENT_ROLES } from "../config.ts";
export { piModelCatalogue, type CatalogueModel, type ModelCatalogue } from "../model-check.ts";
export { installedModelRuntime, EXTENSION_PROVIDERS } from "../installed-providers.ts";

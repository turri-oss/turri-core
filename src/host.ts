/** Operations a desktop host needs besides its session. pi itself is a shared peer. */
import { join } from "node:path";
import { getAgentDir, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export { machineChange, machineChangeReason } from "./regenerate/command-check.ts";
export { doctor, type Check, type DoctorOptions, type Level } from "./setup.ts";
export { installedModelRuntime, EXTENSION_PROVIDERS } from "./installed-providers.ts";

/** The conversations pi has saved for the project, including ones not open in a chat. */
export async function savedChatFiles(cwd: string, sessionDir?: string): Promise<string[]> {
  return (await SessionManager.list(cwd, sessionDir)).map((session) => session.path);
}

/** The path a sign-in sheet shows; credentials are managed by the model runtime. */
export function credentialsFile(agentDir = getAgentDir()): string {
  return join(agentDir, "auth.json");
}

export function loginDeviceId(cwd: string, agentDir = getAgentDir()): string {
  return SettingsManager.create(cwd, agentDir).getOrCreateDeviceId();
}

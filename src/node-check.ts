import { MIN_NODE, nodeVersionOk } from "./environment.ts";

export type Level = "ok" | "missing" | "limited" | "info";

export interface Check {
  level: Level;
  name: string;
  detail: string;
  /** More about it, a line each, shown under the detail. */
  more?: string[];
  /** What to run or do about it. */
  fix?: string;
}

/** The first doctor result, available even before the CLI loads pi or asks about providers. */
export function checkNode(): Check {
  const version = process.versions.node;
  return nodeVersionOk(version)
    ? { level: "ok", name: "Node", detail: version }
    : {
        level: "missing",
        name: "Node",
        detail: `${version} - turri needs ${MIN_NODE.join(".")} or newer`,
        fix: "install a newer Node (https://nodejs.org, or `brew install node`)",
      };
}

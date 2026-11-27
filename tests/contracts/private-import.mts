import assert from "node:assert/strict";
import { createRequire } from "node:module";
// @ts-expect-error The registry is private to the harness, in TypeScript and at runtime.
await assert.rejects(import("@turri-dev/core/regenerate/jobs"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
// Node can require some ESM modules, but the published library advertises only an import entry.
assert.throws(() => createRequire(import.meta.url).resolve("@turri-dev/core"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });

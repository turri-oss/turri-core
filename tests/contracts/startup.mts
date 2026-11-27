// The CLI chooses its runtime, themes and version before importing pi's terminal.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const attempted: string[] = [];
const guard = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@earendil-works/pi-")) {
    attempted.push(specifier);
    throw new Error(`Startup loaded ${specifier}`);
  }
  return next(specifier, context);
} });
try {
  const { checkNode, readProjectConfig, setTurriRoot, turriRoot, versionLine, projectModels } = await import("@turri-dev/core/startup");
  assert.equal(checkNode().level, "ok");
  setTurriRoot(process.cwd());
  assert.equal(turriRoot(), process.cwd());
  assert.equal(versionLine({ version: "1.2.3", git_commit: null, git_dirty: null }, null), "turri 1.2.3");
  assert.ok(projectModels(readProjectConfig(process.cwd())));
  assert.deepEqual(attempted, []);
} finally {
  guard.deregister();
}

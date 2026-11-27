# Development

This is turri's core, the package `@turri-dev/core`: turri without its terminal UI and its command line, which are turri's CLI's and build on it - see [the core](core.md).

```bash
npm run typecheck   # types
npm run api:check   # build and compare each public declaration report in api/
npm run test:package # exercise the consumer contract
npm test            # the whole suite, about a minute
```

The suite runs the projects' testing scripts on this machine, as turri does. The fixture scripts stage each run in a folder of their own, as test files running side by side would otherwise share one.

`.github/workflows/test.yml` checks pull requests and pushes to `main`. It runs the packed consumer on the minimum supported Node (22.19), and the source checks and suite on Node 24. `.github/workflows/commits.yml` checks that a pull request's commits are Conventional Commits with no fixup or merge commit. See [contributing](../CONTRIBUTING.md).

## Mutation testing

`npm run mutation` runs [Stryker](https://stryker-mutator.io) over the core of regeneration - the parts in `stryker.config.mjs` - one part at a time, each part's report in `reports/mutation/<part>/`. A part with a report is skipped, so a run that is stopped goes on from the part it was in; `npm run mutation -- <part>` runs one again, and `npm run mutation -- --summary` sums up the reports there are. It takes hours: each part runs the suite once to find which tests reach which mutant (`vitest.stryker.config.ts`, the suite without the files that run real commands behind the sandbox), then each mutant against those tests. `scripts/mutation.mjs` sets two things in Stryker's vitest runner the suite needs - forked workers, and a test-name filter that matches vitest 5's names - again after every `npm install`.

The `mutation` workflow (`.github/workflows/mutation.yml`) runs it on GitHub, started by hand: Actions, mutation, Run workflow. It takes the parts to run, space-separated (empty for every part), each a job of its own side by side, on four cores (`TURRI_MUTATION_CONCURRENCY`; six here). Each part's `mutation.html` and `mutation.json` are uploaded as an artifact, `mutation-<part>`, and summed up on the run's page. Stryker's incremental file is cached from run to run, so a run tests again only the mutants whose code or tests changed; tick `fresh` to test every one again.

There is no `turri` command here: to try a change in the chat, or with `turri parse`, `turri regenerate --dry-run` and the rest, run turri's CLI on this clone. `npm link` here, `npm link @turri-dev/core` in turri's clone, and start `turri` with `NODE_OPTIONS=--conditions=turri-source`: the CLI then runs the core's sources, unbuilt, and an edit here takes effect at its next start ([importing the core](core.md#importing-the-core)).

The package on npm is built: `npm run build` compiles `src/` into `dist/`, file for file, rewriting runtime imports to `.js`, emitting declarations and copying assets. `npm pack` and `npm publish` run it first. Consumers import only the [named entries](core.md#importing-the-core); the manifest selects declarations and ESM from `dist/`, or a linked clone's TypeScript under `turri-source`.

An intentional change to a public signature comes with its `api/*.api.md` diff. Run `npm run api:report` to regenerate the reports and review the affected entries. CI uses `npm run api:check` to compare without approving changes.

The TypeScript consumer uses `strict`, `module: NodeNext` and `skipLibCheck: true`. pi 1.6.0's generated provider declarations import JSON without the import attributes NodeNext checks; `skipLibCheck` skips those dependency diagnostics. The consumer's own calls and the types it reads from the core are still checked.

`npm run test:package` installs the tarball with the locked dependencies in a temporary consumer, typechecks it and opens a chat through the shared pi peer. To check literal imports in a checkout of either consumer, run `node scripts/check-consumer-imports.mjs ../turri/src ../turri-app/engine`. A relative import into the core also crosses the boundary.

## Publishing

`.github/workflows/publish.yml` publishes `@turri-dev/core` after its checks pass:

- every push or merge into `main` publishes a prerelease under the `next` dist-tag - the patch after the `latest` on npm, with the commit's sha: `0.1.2-next.<sha>`. `latest` is not touched; `npm install @turri-dev/core@next` gets it.
- a GitHub Release tagged `vX.Y.Z`, published by hand, publishes `X.Y.Z` as `latest` (or under `next`, if the release is marked a pre-release). The tag is the version: it is set in the runner and never committed, so `package.json`'s version on `main` is stale by design.

Telling people of a release - the Discord post - is turri's CLI's: nobody installs the core by itself.

The workflow signs in to npm with npm's trusted publishing (OIDC), not a token: the settings of `@turri-dev/core` on npmjs.com trust the repository it runs in, the workflow `publish.yml` and the environment `npm`, and `package.json`'s `repository` names that same repository, or npm refuses the provenance. Renaming the workflow file breaks it.

## Layout

| path | what it is |
|---|---|
| `src/api/` | the five public entries - `session.ts` (`.`), `plain.ts`, `project.ts`, `models.ts`, `system.ts` - each a list of exports, reported in `api/` |
| `src/session.ts` | `createTurri`: the one session every front end opens - its `Frontend`, events and namespaces - over the core (`createTurriCore`) and its chats |
| `src/work.ts` | regenerate and conform work, as the chat's tools and a front end ask it: the loop's call (`planWork`), its checks (`askLoop`), and a run of it - start over, report, export, drain, verdict (`runWork`) |
| `src/errors.ts`, `src/client.ts`, `src/project.ts` | `TurriError` and its codes; who runs turri (`ClientInfo`); what can be asked of a project with no session (drift, a launch of its own) |
| `src/extension.ts` | the [pi](https://pi.dev) extension: every conversation tool and command, and `createTurriCore`, the core the session is built on |
| `src/chat-entries.ts` | what the core appends to a chat and the messages it sends: their types and data, for every front end that draws them |
| `src/session-events.ts` | what the core says happened, internally, and foreground skill progress as data - the session turns it into its events |
| `tests/boundary.test.ts` | the core's boundary with the terminal: no pi-tui, none of pi's terminal, no renderer, key or screen of the core's own |
| `src/setup.ts`, `src/doctor-tool.ts`, `src/environment.ts`, `src/stack.ts` | what `turri doctor` and the chat's `doctor` tool check - this machine, and in a project what its modules need of it; `turri doctor` prints them in turri's CLI |
| `src/init-config.ts` | a project's first `config.turri.yaml`, as `turri init-config` and a host write it |
| `src/chats.ts`, `src/chat-scope.ts`, `src/chat-records.ts` | the session's [chats](chats.md): which chat a pulse is told to, each chat's scope - its id and stack - and `.turri/chats.json` |
| `src/chat-queue.ts` | a message taken out of a session's queue (`unqueue`) |
| `src/sentinel.ts`, `src/sentinel-chat.ts` | [the sentinel](sentinel.md): its prompt, what it is told of a pulse, its fenced tools, its guidance; notices - what is appended of them, the dialog, their answers |
| `src/skill.ts` | parses `SKILL.md` into steps and gates |
| `src/graph.ts` | compiles a skill into a LangGraph `StateGraph`: step -> gate -> route |
| `src/judge.ts` | runs independent judges, applies the quorum, builds the critique |
| `src/genome.ts` | `runSkill()` - the one entry point the CLI and the extension share |
| `src/pi.ts` | [pi](https://pi.dev) session factories for executors, sub-agents and judges |
| `src/loop-tools.ts` | `regenerate`, `drift` and `halt` - one definition each, for the conversation and the skills alike |
| `src/plain/` | the [\*\*\*plain](https://plainlang.org/docs/) parser - see [parser](parser.md) - and `highlight.ts`, which highlights \*\*\*plain with turri's own grammar, `plain.tmLanguage.json` - started from [plyn](https://github.com/plainlang/plyn)'s at `f9c02b8`, and changed here since: test plain files' sections and keys, the `# <id>` heading |
| `src/module-check.ts` | a module checked in its project - `turri parse`, the chat's `parse` and the check before regenerating: the language's check (`src/plain/check.ts`), then its config files, the steps of adding tests it skipped, its base folder |
| `src/regenerate/conformance.ts` | conformance tests: writing them, and fixing the test or the code until they pass |
| `src/regenerate/regenerate.ts`, `src/regenerate/conform.ts` | a code job - a \*\*\*plain diff regenerated in the code - and a conformance job |
| `src/regenerate/loop.ts`, `src/regenerate/records.ts`, `src/regenerate/drift.ts`, `src/regenerate/jobs.ts` | the work loop, the records and the work derived from them, and background jobs |
| `src/regenerate/chunk-plan.ts`, `src/regenerate/cases.ts` | cutting the work into jobs, and what a job's agents are told by its cases |
| `src/regenerate/regression.ts` | the whole conformance suite run, and the repair agent that may not touch tests |
| `src/regenerate/lineage.ts` | module history in `.plaingit` |
| `src/regenerate/launch.ts`, `src/launch-track.ts`, `src/launch-session.ts`, `src/launch-agent.ts`, `src/launch-tools.ts` | launch: a commit to `dist/<module>`, the launch track, the launch agent and what it starts on the host, and `followLaunchedLogs`, which `turri launch` prints what runs through - see [launch](launch.md) |
| `src/regenerate/confine.ts`, `src/regenerate/agent-shell.ts`, `src/regenerate/command-check.ts`, `src/regenerate/os-sandbox.ts`, `src/regenerate/audit.ts`, `src/regenerate/agent-env.ts`, `src/regenerate/shell.ts` | the file-tool fence and the walls around every agent command: the check, the OS sandbox, the audit, the module's environment, the host runner - see [sandbox](sandbox.md) |
| `src/regenerate/model-names.ts` | resolving a model named as the person said it - for a call's `model` and the `settings` tool |
| `src/regenerate/job-panel.ts`, `src/regenerate/diff-where.ts` | a pulse's marks and lines as text - `PANEL_KEY`, `didNotPass`, a \*\*\*plain diff summed up - and where each line of a \*\*\*plain diff is in its files (`locateDiffLines`), which the ledger, a job and a host keep of a pulse's diff |
| `src/regenerate/spec-map.ts` | regen: each item's mark, from the records, the `.plain` files and the work loop's plan (`mapPlan`), and its rungs and focus - what the side panel's map draws |
| `src/regenerate/debug-log.ts` | each regenerating agent's whole conversation, streamed to `.turri/debug/` - while its pulse runs, and kept in debug mode |
| `src/regenerate/pulse-files.ts` | what a pulse writes only for a person - its logs, outputs, temporary files, its chain's installed dependencies - removed as it ends outside debug mode |
| `src/regenerate/failure-reports.ts` | why a pulse that failed or finished without landing did - what `pulses` says of it - kept in `.turri/pulses/<id>.md` whatever the debug setting, for a later session |
| `src/regenerate/ledger.ts`, `src/regenerate/ledger-view.ts` | the ledger: what turri did, as typed facts, in `.turri/ledger/` - `record()`, read back for `pulses` - see [the ledger](using.md#the-ledger) |
| `src/capture/` | [capture](capture.md): the map, areas folded to a budget, the agents and the checks of what they hand over, assembling the modules, the testing scripts, the report, resuming, its status while it runs - `turri capture` is turri's CLI's |
| `genome/` | what turri knows and can do: `genome/skills/`, the skill library, `genome/rules/`, the \*\*\*plain authoring rules, and `genome/capture/`, capture's prompts |

## Known edges

- Judges default to the executor's model. Real separation wants a different provider - set `model:` on the gate. An unconfigured model falls back to the executor's with a note rather than failing the run.
- The executor keeps one session across steps and retries, so context builds up with attempts. Long skills want compaction or a session per step.
- A gate's escalation lives in memory (LangGraph's `MemorySaver`): it must be answered in the same run.
- The gate machinery has no automated coverage; see [trying the gate semantics](skills-and-gates.md#trying-the-gate-semantics).
- Jobs live in memory: there is no resuming a job after [pi](https://pi.dev) exits. The work itself is on disk, so a killed job leaves a partial build rather than nothing.

# The core

turri is two kinds of package. **`@turri-dev/core`** - this one - is everything that decides and does: the session and its chats, the work loop, its pulses and their agents, the sandbox, launch, capture, the sentinel, the ledger, the \*\*\*plain parser, the genome and the standard library, built on [pi](https://pi.dev). **Front ends** build on it: turri's CLI (`@turri-dev/cli`), turri desktop, and any other - an editor's extension, a web service. None is special to the core: each opens the same session, says what it does differently in the same `Frontend`, hears the same events and asks the same methods. With no front end at all, the session works unattended - CI, a scheduled run.

The core draws nothing, prints nothing and exits nothing. It knows no key, panel, widget or spinner; it gives typed data, turri's own words where they are turri's (a launch's text, a pulse's name), and events.

## The five entries

| entry | what | needs a session |
| --- | --- | --- |
| `@turri-dev/core` | the session (`createTurri`), its events, the data they carry, `TurriError`, and turri's words for its data (`launchText`, `pulseName`, `didNotPass`, `pulseCost`, `formatDuration`, `describeAgents`, `captureStageText`, `capturePhases`, the spec map's `rungOf`, `focusOf`, `countOf`, `lineDiff`) | yes |
| `@turri-dev/core/plain` | the \*\*\*plain language: parse and check, the graph, concepts, highlighting (`HighlightState` is opaque), the standard library's stacks, a diff's place in a spec | no |
| `@turri-dev/core/project` | a project on disk: its config read, its settings' catalogue and edits, a first config (`initConfig`), how far its modules are built and what drifted (`projectStanding`, `readDrift`), their history, the ledger of what turri did, the last run's chats (`lastRun`), capture (`runCapture`), a launch of its own (`launchModule`), the code exported (`exportCode`) | no |
| `@turri-dev/core/models` | the vendors' pairs, Amazon Bedrock's makers and geographies, pi's model catalogue, model specs, the providers signed in to | no |
| `@turri-dev/core/system` | the machine: `doctor` (each check named), the Node check, what an agent's command would change on it, the core's version | no |

Nothing else is importable: a private path is `ERR_PACKAGE_PATH_NOT_EXPORTED`. Every type a public signature reaches has a public name. ESM only.

## The session

```ts
import { createTurri } from "@turri-dev/core";

const turri = await createTurri({
  frontend,                                  // what the front end does - none: unattended
  client: { name: "turri", version: "0.5.0" },  // who runs turri: the banner shows it, the ledger and run reports record it
  overrides: { codingModel: "anthropic/claude-haiku-5-5:low" },  // this session's own config values
  onEvent: (event) => {},                    // a listener from the moment it opens
});
try {
  // ...
} finally {
  await turri.dispose();                     // or `await using turri = ...` where the runtime has it
}
```

One session a process, on the project in the process's working folder: a second `createTurri` while one is open throws `session-open`. Several projects in one process - a `cwd` option - is a later step, which will add to this and change nothing in it.

**Options.** `frontend` (below); `client`; `overrides` - `harnessModel`, `codingModel`, `judgeModel` (`provider/model-id[:thinking]`), `review`, `mutationTesting`, `debug` - read in the project as config.turri.yaml's keys, a `models:` entry still winning over them, cleared as the session closes, and a key set with `/settings` dropping the session's value for it; `persist` - keep the open chats in `.turri/chats.json` for `chats.restore("last")`, on by default with a front end; `agentDir`, `sessionDir` - pi's folder and where managed chats are saved; `captured` - opened in the project a capture wrote, its report told in the first chat; `onEvent`.

**`chats`.** `list()`, `get(id)`, `focused()`, `focus(id)` - the chat the person looks at, where a pulse a closed chat asked for is told; `open({ sessionFile?, title?, focus? })` - a fresh chat or a saved one, focused unless `focus: false`, at most nine (`chat-limit`), and none without a front end (`no-chat`); `adopt(session)` - a pi session the front end made with `turri.extension` in it, as a chat; `restore(run?)` - a run's chats, the last one by default, except those open already; `close(id)`. A `Chat` has `id`, `info()`, `session` (pi's `AgentSession`: prompt it, subscribe to it, set its model), `entries()`, `stop()` - its turn, a command, a compaction or a retry stopped, `idle` when it did nothing, never the session ended - and `decline()`, every question it asks declined. A handle to a closed chat throws `chat-closed`. A fresh chat of the person's starts on the project's harness model.

**`work`.** `status()` - each codebase, this session's pulses, those planned, and `busy`; `jobs()`, `job(id)`; `standing(files?)`; `map({ refresh? })` - the spec map, its items marked, read at most every second; `history({ runs? })` - earlier sessions' pulses; `lookAhead(plainFile)` - planned as regenerate would, the plan held, the next pulses' prompts, nothing started; `regenerate(request)` and `conform(request)` - `plainFile` (else config's `module`), `funcIds`, `fromScratch`, `separately`, `model`, `chat` (told when it ends), `startOver` (`true`, `"ask"` through the front end, else the run ends incomplete saying why), `report` (a run report file), `exportTo` (the code exported as it ends), `signal` - each resolving to `{ planned, done }`, `done` the verdict once nothing more can start: `completed`, `failed`, `incomplete` or `stopped`, with every job, those that failed and the codebases unfinished; `halt({ pulse } | { launched })`. These call what the chat's own regenerate and conform tools call (`src/work.ts`), so the two never differ. A session's work loop needs no chat: without one, the coding model builds and the harness model plans, as the config names them.

**`launches`.** `list()`, `running()`, `launch(plainFile?, { chat? })` - resolving when it ends - and `followLogs(onLine, { signal })`. **`notices`.** `list()`, `answer(id, answer)`. **`sentinel`.** `check(request)`. **`settings`.** `get(key, { module? })`, `set(key, value, { module? })` - validated as `/settings` validates it (`refused`, `not-found`), written, and what turri fixed at its start changed now - `choices(key, typed?)` and `turnOnConformanceTests(plainFile?)`, the person's decision, written where the module's value comes from. **`skills`.** `list()`, `run(name, { plainFile?, context?, model?, signal? })` - its questions and review gates put through the front end, its progress as events. `spending()` and `dispose()`.

## The front end

Every member is optional; a front end says only what it does differently.

| member | what it does |
| --- | --- |
| `surface` | where the person watches turri's work, in the front end's own words: told the model, which otherwise names no key, panel or view. The terminal says regen and ctrl+h here; a desktop app its views |
| `extensions` | the front end's own pi extensions, built into every chat after turri's: its renderers, tools, commands and keys |
| `ask(question, { chat, signal })` | a question - ask_user's, a skill's interview, a review gate's: `{ kind: "select", title, options, context?, at? }` or `{ kind: "input", title, context? }` - resolving to the answer, undefined for none; `signal` is aborted when the question is over without it, declined or its turn stopped. Without it, a chat with a screen asks in pi's own dialogs |
| `sessions` | where the chats' pi sessions are made: `{ kind: "managed", ui? }` - turri makes and disposes them, `ui(chat)` the pi UI context a chat's extensions call - or `{ kind: "external", create, show?, release? }` - the front end makes them on its own pi runtime with `turri.extension` built in before `create` resolves (else `extension-not-built`), shows a chat when turri asks, and lets them go itself. Default: managed |
| `reveal(target, { chat })` | the person asked to see something the front end shows - `/pulses`: true when it shows it, else the chat lists it |
| `openProject(dir, { summary, reportFile })` | a capture wrote a project of its own: open it, as the front end opens projects, and tell its report there (a session opened with `captured`); false leaves the report to the chat |
| `openPiSettings()` | pi's own settings, the last entry of `/settings` |
| `systemPrompt(prompt, { chat })` | the last word on a chat's whole system prompt |
| `shows: { pulseEnds?, notices? }` | what the front end shows the person itself, from the events: pulse ends and the sentinel's conclusions - the chat's agent is told them with no turn of its own - and notices, which a chat then never puts as a question |
| `sentinel: { tools?, surface? }` | the sentinel's own tools beside turri's - a front end's browser - and where the person watches it use them |

**No front end** is unattended: no chats, the sentinel never opens, nobody is asked - a start over is refused with why, never waited on.

Whatever the front end, the same rules hold: turri appends its entries to a chat's transcript (a transcript is a record; whether to draw one is the front end's choice), a chat is marked unread when something happens in it out of sight, its `"question"` status is turri's own pending asks, and what turri says outside any transcript is a `notification` event as well as said in the chat shown.

## Events

`turri.on(type, listener, { signal? })` hears one type, `turri.on(listener)` every one; both return what stops hearing. `turri.events({ signal? })` is the same stream as an async iterable, ended as the session is let go. Events are plain data, safe to `structuredClone` and send to another process - snapshots, never live objects or pi sessions. Dispatch is synchronous, in the order things happen; a listener that throws reaches `process.emitWarning` (`TURRI_LISTENER`), never turri or another listener.

| type | when | carries |
| --- | --- | --- |
| `chats` | a chat opened, closed, renamed, started or stopped working or asking | `chats` |
| `chatSession` | a chat's pi session replaced under the same id - the sentinel's fresh conversation | `chat` - read `chats.get(chat).session` |
| `entry` | turri appended an entry or sent a message to a chat | `chat`, `entry` |
| `notification` | turri said something to the person outside any transcript | `chat?`, `text`, `level` |
| `job` | a pulse started, moved on, or ended | `job`, `final` - ended and not run again as another |
| `plan` | what is planned changed, no pulse changing | |
| `launch` | a launch asked for, started or ended | `launch` |
| `notice`, `noticeOver` | put to the person; answered, dismissed or superseded - `job` or `check` filled in when the sentinel was checking one | `notice` |
| `concluded` | the sentinel done with a pulse or a check | `chat`, `conclusion` |
| `skillProgress` | a foreground skill's place in its phases; null as it ends | `chat?`, `progress` |
| `captureProgress`, `captureEnded` | a capture's status; its end | `chat?`, `status` / `root`, `state`, `result` or `error` |
| `incident` | a provider failing and waited out, a turn turri ended itself | `text`, `event` |
| `spending` | what the session spent changed | `spending` |
| `failure` | turri's own healer, a provider, the history or the planner failed | `what`, `text` |
| `renamed` | a func-id or scenario-id renamed in a module's records | `what`, `from`, `to`, `spec` |
| `orphansStopped` | a killed turri's process groups stopped as the session opened (hear it with `onEvent`) | `count` |

## The transcript's entries

What the core keeps in a chat besides its messages - the entries it appends and the custom messages it sends - is typed in `src/chat-entries.ts` and exported: `ChatEntryMap` (each entry's `data` by its `customType`), `ChatMessageMap` (each message's `details`), a constant for each type, and `ChatEntry`, their union. `isChatEntry(record)` tells turri's records in a pi transcript, safe as an array filter; `isChatEntryOf(record, customType)` narrows to one. A field a later turri added is optional, as a chat saved earlier lacks it.

| type | constant | appended or sent | data |
| --- | --- | --- | --- |
| `turri_banner` | `BANNER_ENTRY` | once a chat, at its first `session_start` | `BannerData`: who runs turri (`name`, `version`, the clone's `commit`), skills that failed to load, the sandbox, what turri says of the config files |
| `turri_command_outcome` | `COMMAND_OUTCOME` | an entry: what a slash command showed the person; a message (`display: false`): what the conversation is told of it | `CommandOutcome` |
| `turri_btw` | `SIDE_ENTRY` | a side question (`/btw`) answered | `{ question, answer }` |
| `turri_skill_message` | `SKILL_MESSAGE_ENTRY` | a message the person sent while a skill ran | `{ text, skill }` |
| `turri_exchange` | `INTERVIEW_ENTRY` | each question of a skill's interview, answered | `Exchange` |
| `turri_job` | `JOB_ENTRY` | a pulse's end, in the chat told of it; and a message its agent is told by | `JobAnnouncement`; `JobRef` |
| `turri_history` | `HISTORY_ENTRY` | `/lineage` | `{ module, text }` |
| `turri_notice`, `turri_notice_over` | `NOTICE_ENTRY`, `NOTICE_OVER_ENTRY` | a notice put in the chat; one over | `Notice`; `{ state, summary }` |
| `turri_sentinel_concluded` | `CONCLUDED_ENTRY` | the sentinel concluded a pulse or check: an entry, and a message the chat's agent is told by | `Conclusion` |
| `turri_skill_run`, `turri_skill_report` | `SKILL_RUN_ENTRY`, `SKILL_REPORT_ENTRY` | a background skill's end: an entry for one that did its work, a message for one that did not; what one that did has for the agent - a capture's report | `{ text }`; `{ skills, runs }` / `{ skills }` |
| `turri_version`, `turri_milestone`, `turri_jobs` | `VERSION_ENTRY`, `MILESTONE_ENTRY`, `JOBS_LIST_ENTRY` | by an earlier turri only - chats it saved have them | |

The messages a chat's agent is sent, unseen: `SPEC_CONFLICT_MESSAGE`, `SENTINEL_PULSE_MESSAGE`, `SENTINEL_CHECK_MESSAGE`, `SENTINEL_RESUME_MESSAGE`, `JOB_LANDED_MESSAGE`, `NOTICE_ANSWER_MESSAGE`, `LAUNCH_MESSAGE`.

A pulse's `Job.details` is `JobDetails`: `passed`, `landed`, `skipped`, `stoppedAt` (where its gate stopped one that did not pass), `notBuilt`, `story`, `specGaps`, `commit` - kept on a job that failed for good too.

## Errors

A call that cannot be made as asked throws a `TurriError` with a `code`: `config-invalid`, `refused`, `chat-limit`, `no-chat`, `chat-closed`, `not-found`, `extension-not-built`, `session-open`, `aborted`; its `cause` is what it came from. An outcome that is expected - a notice already over, a check refused, a chat idle when stopped - is returned, never thrown. Tell one with `isTurriError(error, code?)`, not `instanceof`: a front end and a package it depends on may each have their own copy of the core.

## The boundary

What only a screen needs is the front end's. `tests/boundary.test.ts` reads every file under `src/` by its syntax - a comment or a string that names one is not a crossing - and fails on any of these, naming the file and line:

- **pi-tui**, anywhere in the core - type imports, re-exports, a dynamic `import()` or `require` included. A front end measures text and draws; the core reports progress as data.
- **pi's terminal**, from `@earendil-works/pi-coding-agent`: its interactive mode and runtime, CLI, components, editor, borders, key hints and themes - imported or re-exported by name, as a type, a namespace member, destructured or dynamically. Re-exporting all of pi crosses it too: a front end imports its pi peer itself.
- **What only a screen does**: `registerEntryRenderer`, `registerMessageRenderer`, `registerShortcut`, `setFooter`, `setHeader`, `setEditorComponent`, `onTerminalInput` and a ui's `custom`, however they are read. One core file passes one on, doing nothing of its own with it, and is let by there alone: `chats.ts` hands pi's `registerShortcut` a handler run in the chat's scope (`scopedToChat`) - a front end's extension registering a key in a chat.

The core may call `ctx.ui`'s abstract methods - `notify`, `select`, `input`, `confirm`, `setStatus`, `setWorkingMessage` - which any front end answers. A seam a front end needs is a member of `Frontend`, an event or a method of the session - never a copy of the core's state or logic in the front end.

## Importing the core

Node's package export map is the import boundary, for an installed package and a linked clone alike. The JavaScript and declarations are ESM; `moduleResolution` `node16`, `nodenext` or `bundler` reads them. The core finds its genome, standard library and prompts beside its own files (`import.meta.url`): a bundler keeps the package external rather than bundling it.

**pi is a peer.** The core and its front end share `@earendil-works/pi-coding-agent` at the exact version in `package.json`: a chat's `AgentSession` is pi's, a front end's extension is built into pi's sessions, and a prototype patched in one must be the one the other runs. pi's types are in the core's, so a pi upgrade is a breaking release of the core. When developing with `npm link`ed checkouts, make both resolve pi to the same installation.

**A clone runs its sources.** Each entry has a `turri-source` condition pointing at `src/`: a front end started with `NODE_OPTIONS=--conditions=turri-source` runs a linked core clone unbuilt; without it, Node loads `dist/`.

## Versioning

The surface is 0.x until the front ends that build on it - the CLI, then turri desktop - run on it: each migration may change it. `api/<entry>.api.md` is each entry's declaration report; `npm run api:check` fails on any change to it, `npm run api:report` writes the change for review, and `CHANGELOG.md` says what changed and why. A breaking change bumps the minor version while 0.x.

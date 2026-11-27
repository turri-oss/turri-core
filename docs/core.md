# The core

turri is two packages. **`@turri-dev/core`** - this one - is everything that decides and does: the session and its chats, the work loop, its pulses and their agents, the sandbox, the launch track, capture, the ledger, the \*\*\*plain parser, the genome and the standard library, built into [pi](https://pi.dev) as an extension. **turri's CLI** (`@turri-dev/cli`, the `turri` repository) is the command line and the terminal: the `turri` command and its subcommands, and everything a screen draws of a session. The CLI builds on the core; the core knows nothing of the CLI. A host that runs the chats in its own windows - turri-app - builds on the core too, through [its host entry](hosting.md), and draws nothing of the terminal's.

The core draws nothing, prints nothing and exits nothing. Where the terminal drew, the core calls its **view** (`src/view.ts`); where a command printed, asked or exited, it calls its **headless view** (`src/headless.ts`) or returns. Given no view, the core does what it always did for a host and a headless run.

## The boundary

What only a screen needs is the CLI's. `tests/boundary.test.ts` reads every file under `src/` by its syntax - so a comment or a string that names one is not a crossing - and fails on any of these, naming the file and line:

- **pi-tui**, anywhere but `src/text-width.ts` - imported, re-exported (`export ... from`, `export * from`), as a type's `import()`, with a dynamic `import()` or `require`. That file re-exports pi-tui's `visibleWidth` and `truncateToWidth`, and nothing else: the `turri-skill` widget lays its progress line out by them, and turri-app reads that line back by its spacing, so the core measures text exactly as pi's screen does.
- **pi's terminal**, from `@earendil-works/pi-coding-agent`: its interactive mode, the runtime whose session a screen swaps and its command line - `InteractiveMode`, `AgentSessionRuntime`, `main` - and what it draws with: every name ending in `Component` (`UserMessageComponent`, `ToolExecutionComponent`, ...), `DynamicBorder`, `BorderedLoader`, `CustomEditor`, `keyHint`, `keyText`, `rawKeyHint`, `renderDiff`, `getMarkdownTheme`, `initTheme`, `getSelectListTheme` and `getSettingsListTheme`. Each is a crossing however it is reached: imported or re-exported by name (`as` another name too), as a type (`import("…").InteractiveMode`), taken from a dynamic `import()` or `require` - destructured or read off it - or through pi's whole API under one name - `import * as P`, `const P = await import(…)` or `require(…)`, or a name given one, `const Q = P` - read off it (`P.InteractiveMode`, `P["InteractiveMode"]`, a type `P.InteractiveMode`) or destructured from it (`const { InteractiveMode } = P`). pi re-exported whole would hand all of them on, and is a crossing too - `export * from` pi, `export * as <name> from` pi, `export { P }` of such a name - except `host.ts`'s `export * as pi`, all of pi for a host that runs the chats itself.
- **What only a screen does**: `registerEntryRenderer`, `registerMessageRenderer`, `registerShortcut`, `setFooter`, `setHeader`, `setEditorComponent` and `onTerminalInput`, whatever they are read from and whatever is done with them - called, kept (`const reg = pi.registerEntryRenderer`), taken out by name (`const { registerShortcut } = pi`), read by a string key (`pi["registerShortcut"]`) or called by a bare name; and a ui's `custom`, read off anything that is a ui - `ui`, `x.ui`, `x["ui"]`, a name given one (`const io = ctx.ui`, `const { ui: io } = ctx`), or anything typed or cast as one: `ExtensionUIContext` (`pi.ExtensionUIContext` too), any type's `["ui"]` (`ExtensionContext["ui"]`), `typeof ctx.ui`, or a type the file names for one (`type Screen = ExtensionContext["ui"]`) - or destructured from one (`const { custom } = ctx.ui`). Beyond the test: a name read by a key computed as the code runs (`pi[key]`), and a ui or pi's API a file reaches without naming it - one a call returns, or one typed by an interface of the file's own. Two core files pass one on without doing anything of their own with it, each site let by for its file, the function it is in and the name it is read from, and checked to be still there: `chats.ts` hands the view pi's `registerShortcut`, its handler run in the chat's scope (`target.registerShortcut` in `scopedToChat`), and `chat-ui.ts`, a hidden chat's stand-in for the screen, passes pi's `onTerminalInput` on to the screen the chat is shown on (`screen` and `next` in `createChatUi`). Anywhere else in those files, it is a crossing.

The core may call `ctx.ui`'s abstract methods - `notify`, `select`, `input`, `confirm`, `setStatus`, `setWorkingMessage`, `setWidget` - since a host answers them as well as a screen does; the `turri-skill` widget, which turri-app parses, stays the core's.

A seam the CLI needs is a hook in `TurriView` or an exported accessor in the core - never a copy of the core's state or logic in the CLI, and never a pi-tui import here.

## The view

`TurriView` is given to `createTurriCore(host, { view })` - never as a `TurriHost` field, since a host with any key is a host to the ledger - and read back as `session.view`. Every hook is optional. Each is called at the point where the core drew before the split, with what the drawing read.

| hook | called | what the CLI does there |
| --- | --- | --- |
| `chat(pi, chat)` | in every chat - the sentinel's too - as its extension is built, inside the chat's scope: after the handlers that remember the chat's context, just before the core's banner, `/stdlib` and the conversation's tools, and before the return of a chat with no skills - so every chat gets it | registers the renderers of every entry and message the core appends ([the entries](#the-entries)); paints the banner and the jellyfish on `session_start` while `session.welcomeVisible(chat.link.id)`, pads the screen and highlights \*\*\*plain code blocks; registers `PANEL_KEY` (`ctrl+h`) and points the side panel's `say` at this chat |
| `chatCommands(pi, chat)` | in every chat of a terminal session (`TurriCore.terminal`), inside the chat's scope: right after `/btw`, the last of the conversation's commands, and before the commands of a project's command-only skills and `/capture` - and before the return of a chat with no skills - so pi's command list keeps turri's order | registers `/chat`, `alt+n`, `alt+w`, `alt+1…9` and the chat strip |
| `questions.dialogs(ctx, declining, decline)` | for each question asked in a chat with a screen and no host dialogs (`askUserVia`): the conversation's `ask_user`, a skill's interview - every caller passes `session.view?.questions` | puts the question in turri's dialog over the chat - its options, "Something else…", what was said before it - calling `decline` when the person presses `ctrl+c`, and setting `declining.close` so a stopped turn closes it |
| `questions.whileAsking(ctx)` | as each such question opens; its undo once it is answered or declined | lets the side panel's key through the dialog, so the person can peek at regen and the pulses while the question waits |
| `panel(session)` | once a session, as the first chat is built (cached by session, `sidePanelOf` in extension.ts) | makes the side panel: regen, the pulses, and finished pulses with the sentinel's notices - drawn from `shownJobs`, `plannedLoop`, `sessionLaunchesOf`, `spec-map.ts`, `job-panel.ts` and `diff-where.ts` |
| `panel(...).open(ctx, page, placement)` | `/pulses` (`"pulses"`, in a chat with a screen), `/notifications` (`"notifications"`, `"beside"` - registered in a terminal session only), and the chat header's toggle, `link.live.plainPanel.toggle` (`"map"`, `"beside"`, with the chat's last context) | opens the panel over the screen, or beside the chat |
| `panel(...).visible()` / `.close()` | `link.live.plainPanel.open()` and its toggle | says whether the panel is on the screen, and closes it |
| `pulseFinished(job)` | for every pulse that ends and is not replaced by another, just before the session tells its chats (`TurriCore.jobFinished`) | remembers a pulse that failed, was stopped or did not pass (`didNotPass`), so the side panel opens on it at the next `ctrl+h` |
| `captureProgress(ctx)` | as `/capture` starts a capture in a chat with a screen; `update(status)` with each status the capture reports, `close()` as it ends, however it ends | draws the capture's status above the input - its phase, each agent at work and what it did last - from `CaptureStatus`, `COMPACT_PHASES`, `captureStageText` and the spinner |
| `openPiSettings()` | when the person picks pi's own settings, the last entry of `/settings`; false or absent, the core says they open only in the terminal's chat | opens pi's own settings menu, patched into `InteractiveMode` |

The hook's parameters:

- **`ViewChat`** - `session` (the `TurriCore`), `link` (the chat's `ChatLink`) and `context()`, the context the chat's tools and handlers were last given - undefined until its session starts.
- **`QuestionView`** - `dialogs` and `whileAsking`, above. With a screen and no view's dialogs, a question is put in pi's own `ctx.ui.select` and `ctx.ui.input` (`uiDialogs` in extension.ts), what to read above it; with no screen and no host dialogs, the asker is told no one is there to answer (`NO_USER_ANSWER`).
- **`Declining`** - `declined`, and `close`, set by the dialog shown.
- **`SidePanelView`** - `open(ctx, page?, placement?)`, `visible()`, `close()`; **`PanelPage`** is `"map"`, `"pulses"` or `"notifications"`.
- **`CaptureProgressView`** - `update(status)` and `close()`, which may be called more than once.

## The entries

What the core keeps in a chat besides its messages - the entries it appends and the custom messages it sends that a front-end draws - is a contract with two readers: the CLI's renderers and turri-app, which draws them from their data itself. Their types and data are in `src/chat-entries.ts`, except where a module of their own owns them. Renaming a type or a field here renames it for both.

| type | constant | appended or sent | data |
| --- | --- | --- | --- |
| `turri_banner` | `BANNER_ENTRY` | once a chat, at its first `session_start` | `BannerData`: the version, the clone's commit, skills that failed to load, the sandbox, newer versions, what turri says of the config files (`config`, which turri-app shows) |
| `turri_version` | `VERSION_ENTRY` | when a newer turri is found once turri has started | `{ text }` |
| `turri_command_outcome` | `COMMAND_OUTCOME` | an entry: what a slash command showed the person - first the command as typed (`echoCommand`, then one 20 ms frame), then its outcome; a message (`display: false`): what the conversation is told of it | `CommandOutcome`: `command`, `text`, `level`, `echoed` |
| `turri_btw` | `SIDE_ENTRY` | a side question (`/btw`) answered | `{ question, answer }` |
| `turri_skill_message` | `SKILL_MESSAGE_ENTRY` | a message the person sent while a skill ran, read by the skill's agent | `{ text, skill }` |
| `turri_exchange` | `INTERVIEW_ENTRY` | each question of a skill's interview, answered | `Exchange`: `skill`, `said`, `question`, `answer` |
| `turri_job` | `JOB_ENTRY` | a pulse's end, announced in a chat | `JobAnnouncement` |
| `turri_history` | `HISTORY_ENTRY` | `/lineage` | `{ module, text }` |
| `turri_milestone`, `turri_jobs` | `MILESTONE_ENTRY`, `JOBS_LIST_ENTRY` | by nothing now - chats saved earlier have them, and they are still drawn | |
| `turri_notice` | `NOTICE_ENTRY` (`sentinel-chat.ts`) | a sentinel's notice, in a session that is not the terminal's | `Notice` |
| `turri_notice_over` | `NOTICE_OVER_ENTRY` (`sentinel-chat.ts`) | a notice answered or over, likewise | `{ state, summary }` |
| `turri_sentinel_concluded` | `CONCLUDED_ENTRY` (`sentinel-chat.ts`) | an entry when the sentinel concludes a pulse, likewise; and in every session, a message (`display: false`) the chat's agent is told by | `Conclusion` |
| `turri_skill_run` | `SKILL_RUN_ENTRY` (`background-skills.ts`) | an entry for each background skill that did its work; a message (`display: false`) for those that did not | `{ text }`; the message's `details`: `{ skills, runs }` |
| `turri_skill_report` | `SKILL_REPORT_ENTRY` (`background-skills.ts`) | a message (`display: false`): what a background run that did its work has for the chat's agent - a capture's report | `details`: `{ skills }` |

`extension.ts` still re-exports `COMMAND_OUTCOME` and the `Exchange` type, as before the split.

## Unattended runs

The commands that build - `turri regenerate` (`--dry-run` a look ahead) and `turri conform` - run `runHeadless(run, view)` (`src/headless.ts`), the work loop driven as the chat drives it: the project's models, a job that fails run once more and, failing again, diagnosed; the loop run until nothing more can start; the code exported into `--build-dir` as the process exits, however it exits, before the run report's last write. It prints nothing, asks nothing and never exits the process. A run refused before it starts - a test plain file, a config that does not parse, a `--build-dir` the export would wipe something in - throws; one that ran returns how it ended, `completed`, `incomplete`, `failed` or `dry_run`, with the exit code the command ends with.

`HeadlessRun` is the request: the `.plain` file, `buildDir`, `report`, `command` (as the run report gives it), `dryRun`, `startOver` and `ask`, what the run asks of the work loop. `HeadlessView` is what a person would be shown and asked, each at the point it happens - the CLI's console prints it as it did before the split:

| hook | when |
| --- | --- |
| `orphansStopped(count)` | before anything starts, when a turri that was killed left process groups running and they were stopped |
| `warn(message)` | what the ledger could not write |
| `exported(exported, buildDir)` | as the process exits: the code exported into `--build-dir`, or why nothing was |
| `pulseRunning(job)` | a pulse starting, and again at each new stage |
| `pulseFinished(job)` | a pulse ended, however it ended, before the run report is written again |
| `turnIncident(event, line)` | a provider failing and waited out, a turn turri ended itself |
| `planned(statuses)` | what the request planned in each codebase, and again after a start over |
| `canAsk()`, `ask(title, body)` | whether there is someone to ask, and whether to start over a codebase that has to be on a module it now requires |
| `startOverRefused(message)` | the run stops at such a codebase, with no one to ask and no `startOver` |
| `nextPulse(pulse)` | a dry run: each codebase's next pulse, from the plan the look ahead kept |
| `drained(statuses)` | nothing more can start: how each codebase stands |
| `ended(end)` | how the run ended: every job, those that failed, the codebases not complete |

`moduleStates`, `buildDirProblem`, `exportCode` and `reportModels` are exported beside it. The flags (`headlessOptions`), the console and `process.exit` are the CLI's.

## What else the CLI takes from the core

The CLI draws from the core's own state and words, exported - never copied:

- **The session**: `TurriCore` - `terminal`, `welcomeVisible(chat)`, `view` - and each chat's `ChatLink`, whose `live.plainPanel` the chat header reads; a `ChatDriver` with `terminal: true` for the terminal's chats; `chat-ui.ts`, a hidden chat's stand-in for the screen.
- **The pulses and the panel**: `shownJobs`, `plannedLoop` and `sessionLaunchesOf` (extension.ts); `PANEL_KEY`, `spinner`, `didNotPass`, `finishedMark`, `pulseCost` and `summarizeDiff` (`regenerate/job-panel.ts`); `Rung`, `rungOf`, `focusOf` and `lineDiff` with regen's marks (`regenerate/spec-map.ts`); `DiffWhere`, `locateDiffLines` and `DIFF_HEADER` (`regenerate/diff-where.ts`); `TerminalNotifications`, the terminal session's inbox (`notifications.ts`); `QueueOf` and `unqueue` (`chat-queue.ts`).
- **Capture's status**: `CaptureStatus`, `CAPTURE_PHASES`, `COMPACT_PHASES` and `captureStageText` (`capture/progress.ts`), and `skillProgressLine` (`skill-progress.ts`).
- **The commands**: `followLaunchedLogs(onLine)` (`regenerate/launch.ts`), what `turri launch` prints of what runs as it logs; `doctor`, `allChecks`, `verdictOf`, `MARK` and each check (`setup.ts`), which `turri doctor` prints; `initConfig` and its presets (`init-config.ts`), which `turri init-config` asks for, its colours an injected `Paint` (`PLAIN_PAINT`, no escape codes, by default); `runSkill` (`genome.ts`), for `turri cultivate`; the capture itself (`src/capture/`), for `turri capture`.
- **This turri**: `setTurriRoot(root)` and `turriRoot()` (`environment.ts`, `@turri-dev/core/environment` - the module the core reads it from). The turri the person runs is the CLI's package, not the core's, and only the CLI knows where it is: it calls `setTurriRoot(<its own package root>)` as it starts, before it draws the banner, answers `--version`, runs `turri doctor` or starts a headless run - before anything that asks which turri this is. From then on, everything that says so follows `turriRoot()`: `turriIdentity` - the version and the clone's commit in `BANNER_ENTRY`'s data, the ledger's `run.started` and the run report - and `versionLine` with it; `describeVersion` (`turri --version`), `versionFindings` and `turrisOnPath` (`turri-versions.ts`: the banner's warnings, `turri --version` and `turri doctor`, which turri on the PATH is this one); `globalExtensionFile`, the global pi extension file naming this turri; `themeFiles` and `themesInstalledGlobally`, its `.pi/themes`; and `checkTurri`'s fix in `turri doctor`, `npm link` in this turri's clone. Unset, `turriRoot()` is `PACKAGE_ROOT`, the core's own package - the turri a host runs through `@turri-dev/core/host`; a CLI that does not set it describes `@turri-dev/core` instead of itself - the core's version on its banner, in its ledger and its run report, and its own install on the PATH taken for another turri, warned about as one in front of this one. `PACKAGE_ROOT` stays the core's whatever is set: the genome, the standard library, the rules, capture's prompts and the diagnosis's harness folder are read from the core's own package.

## What stays in turri's CLI

- **The commands**: `bin/turri.mjs`, `cli.ts`, `cli-options.ts`, and `capture-cli.ts`, `conform-cli.ts`, `cultivate-cli.ts`, `drift-cli.ts`, `launch-cli.ts`, `lineage-cli.ts`, `loop-cli.ts`, `parse-cli.ts`, `regenerate-cli.ts`; `module-report.ts`, `resume-line.ts`, `regenerate/delivery.ts`; `turri doctor`'s report and prompts, `turri init-config`'s questions and flags; `brand.ts`, its colours.
- **pi in the terminal**: `pi-launch.ts`, which builds the extension into pi with the view; `pi-settings.ts`, `pi-themes.ts` and `.pi/`'s themes. The themes are found in the CLI's own package: where `cli.ts` and `pi-themes.ts` read `join(PACKAGE_ROOT, ".pi", "themes")` before the split, they read the CLI's root - `turriRoot()` once set - since the core's `PACKAGE_ROOT` has no `.pi/`.
- **The terminal's chats**: `chat-terminal.ts`, `chat-commands.ts`, `chat-tabs.ts`, `chat-tab-header.ts`, `chat-waiting.ts`.
- **What a screen draws**: the renderers, `question-dialog.ts`, `screen-padding.ts`, `pointer-hover.ts`, `terminal-images.ts`, `picture-row.ts`, `jellyfish.ts`, `plain-code-blocks.ts`, `terminal-notifications.ts`'s drawing, and the side panel - `regenerate/side-panel.ts`, `jobs-tree.ts`, `spec-map-view.ts`, `panel-dock.ts`, `plain-palette.ts`, `transcript-view.ts`, `diff-view.ts`.
- **What is shipped beside them**: `assets/`, `docker/` and `examples/`.

Their tests stay with them.

## Importing the core

The package exports:

| entry | what | published | under `turri-source` |
| --- | --- | --- | --- |
| `@turri-dev/core` | the extension: `createTurriCore`, `processSession`, the default export, and the helpers the CLI and the tests use | `dist/extension.js` | `src/extension.ts` |
| `@turri-dev/core/host` | [a host's entry](hosting.md) | `dist/host.js` | `src/host.ts` |
| `@turri-dev/core/<path>` | any other module by its path under `src/`, without its extension: `@turri-dev/core/view`, `@turri-dev/core/headless`, `@turri-dev/core/chat-entries`, `@turri-dev/core/regenerate/job-panel` | `dist/<path>.js`, its types in `dist/<path>.d.ts` | `src/<path>.ts` |

The package on npm is `dist/` alone: `npm run build` compiles `src/` into it, file for file, as Node runs no `.ts` file inside a `node_modules`. A clone of the core runs unbuilt instead. Linked into a clone of the CLI - `npm link` here, `npm link @turri-dev/core` there - it is found through the link's real path, outside any `node_modules`, so Node's type stripping runs its sources; started with `NODE_OPTIONS=--conditions=turri-source`, every entry resolves to `src/`, and an edit here is in the CLI at its next start, with nothing built. For the CLI's typecheck to read the sources too, its `tsconfig.json` gives `"customConditions": ["turri-source"]`; without it, TypeScript reads `dist/`'s declarations, after a build.

The condition has a name of its own: pi's packages answer `source` with a `src/` they do not publish, so a run started with `--conditions=source` cannot find them.

## turri-app

turri-app keeps using `src/host.ts` - the same file, with the same exports: `createTurri` and the session's types, the project and its settings, a \*\*\*plain file parsed, checked and coloured, the work loop, the ledger, `doctor`, `initConfig`, and pi itself (`pi`). It imports it as `@turri-dev/cli/host` from npm, or from a clone's `src/host.ts` with `TURRI_DEV`; from this package it is `@turri-dev/core/host`, or `TURRI_DEV` naming a clone of the core. It passes no view: its questions go to its own dialogs (`TurriHost.dialogs`), it draws what the core appends to a chat from the data in [the entries](#the-entries), and it reads the `turri-skill` widget's line back by its spacing. Moving its dependency from `@turri-dev/cli` to `@turri-dev/core` is turri-app's own change.

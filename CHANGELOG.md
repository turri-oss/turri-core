# Changelog

`@turri-dev/core` follows [semantic versioning](https://semver.org/); while it is 0.x, a breaking change bumps the minor version. A pi upgrade is a breaking change: pi's types are in the core's.

## 0.2.0 - unreleased

One interface for every front end. 0.1.0's surface was cut for its two consumers - a terminal entry with the CLI's internals, a host entry for turri desktop, the CLI's start-up and commands - with two kinds of session and protocols through environment variables. 0.2.0 replaces it with one session any front end opens, and entries by domain. [The core](docs/core.md) is the whole interface.

### Breaking

- **Five entries by domain:** `.` (the session), `/plain`, `/project`, `/models`, `/system`. Gone: `/host`, `/terminal`, `/startup`, `/commands`, `/config`, `/ledger`, the default extension export and `processSession`. Config reading, `initConfig`, the ledger, drift, history and capture are in `/project`; vendors, Bedrock and the model catalogue in `/models`; `doctor` and the Node check in `/system`.
- **One session:** `createTurri({ frontend, client, overrides, ... })` for every front end, or none. A front end says what it does differently in `Frontend` - `surface`, `extensions`, `ask`, `sessions` (`managed` or `external`, with `Turri.extension` and `chats.adopt` for pi sessions it makes), `reveal`, `openProject`, `openPiSettings`, `systemPrompt`, `shows`, `sentinel`. `createTurriCore`, `TurriView`, `ChatDriver`, the host session's callbacks and `runHeadless`/`HeadlessView` are gone.
- **Typed events:** one stream of plain-data events (`TurriEventMap`: `chats`, `entry`, `job`, `plan`, `launch`, `notice`, `concluded`, `skillProgress`, `captureProgress`, `spending`, `failure`, ...) by `on(type)`, `on()`, `events()` or `onEvent`, replacing `TurriHost`'s callbacks, `onChats`, `onLedgerEvent` and `onModelEvent`.
- **Operations instead of commands:** `work.regenerate`, `work.conform`, `work.halt`, `work.lookAhead`, `work.map`, `work.history`, `settings.set`/`get`/`choices`/`turnOnConformanceTests`, `launches.*`, `notices.*`, `sentinel.check`, `skills.list`/`run`. `regenerate` and `conform` resolve to what they planned and a `done` verdict, with start over, a run report and an export as options.
- **No terminal special case:** the core no longer has a terminal flag, an inbox (`TerminalNotifications`), a welcome, a hidden chat's screen stand-in or a side panel; transcript entries are always appended, and a chat's `"question"` status comes from turri's own pending asks. With no `surface`, the model is told of no key, panel or view.
- **No protocols between core and front end:** `overrideConfig` and `TURRI_CODING_MODEL` become the session's `overrides`, held for its project - a `models:` entry for the role still wins over them; `setTurriRoot`/`turriRoot` become `client`; the reopen file and `TURRI_REOPENED_AFTER_CAPTURE` become `Frontend.openProject` and `captured`. The CLI's own concerns leave the core: update and PATH checks, the version line, themes, the old global pi extension file, `dropNoise` and the doctor's install checks.
- **Errors:** refusals are `TurriError`s with a `code` (`config-invalid`, `refused`, `chat-limit`, `no-chat`, `chat-closed`, `not-found`, `extension-not-built`, `session-open`, `aborted`), told apart with `isTurriError`.
- **Types:** `Job.details` is `JobDetails`; `ChatEntryMap`, `ChatMessageMap` and a constant for every message type are exported, with `isChatEntryOf`; `HighlightState` is opaque; `initConfig`'s model pair is `ModelPair`. Every type a public signature reaches has a public name.
- **Settings by key and type:** `settings.get`, `set` and `choices` take a `SettingKey`, and a value of the setting's type (`SettingValues`); `get` throws `config-invalid` for a value the file has that its kind cannot take. `/project`'s `currentValue` is `readSetting`, typed the same way; `Setting.key` is a `SettingKey`.
- **The check, by domain:** `checkPlainFile` and `checkPlainTargets` (`/plain`) are the \*\*\*plain language's check alone. What the project says of a module - two config files among those it requires, the steps of adding tests it skipped, a base folder not there - is `checkModule` and `checkModules` (`/project`), the check `turri parse` runs.
- `chats.restore` reopens a run's chats except those open already, replacing `skipFirst`. `Chat.stop()` never ends the session: what a front end's interrupt does beyond it is its own.

### Added

- A session's work loop runs with no chat open, on the config's models: the coding model builds, the harness model plans.
- A person's chat runs on `harness-model`: put on it as it starts and whenever it changes, a model chosen in the chat holding until then. While it cannot be reached - no such model, or its provider not signed in - the chat refuses what is sent to it and says why, rather than reaching pi's own choice of model: `Chat.outOfReach()`, the `outOfReach` event, and `chats.onHarnessModel()` after a sign-in.
- A front end with no chats: `sessions: { kind: "none" }` - it answers questions and hears the events, and no chat opens, so neither does the sentinel. `Frontend.ask`'s `chat` is optional, none for a question outside any chat.
- `startOver` takes a function, asked for the run alone with what would be started over and why (`StartOverQuestion`): a command with no front end asks at its terminal. `false` is "no": the rest of the chain is regenerated, as a "no" through the front end did; absent or unanswered, the run ends at once.
- `skills.run({ dir })` runs the skill in a folder with a SKILL.md, as `turri cultivate <folder>` does, beside one by name.
- A skill run says what it does as it goes: `skills.run`'s `onReport` hears each step tried, its artifact, each gate's judges and verdicts and its decision with the critique (`SkillReport`), and `skills.list()` gives each skill's steps and gates (`SkillInfo`). `SkillResult.runDir` says where the run's artifacts are.
- `launches.followLogs` and `followLaunchedLogs` stop on a signal.
- `launchOutput` events: each launch's agent's words as they stream. `launches.launch` takes `onOutput`, `signal`, `guidance`, `inModule` and `again`, and `launchModule` `onOutput`.
- `map` events: the spec map as it changes, for a front end that shows it (`Frontend.shows.map`) - its files looked at each second, its marks laid again as the work moves.
- `settings.set` writes through `/settings`' own path: a path outside the project and a project-wide setting in a module's file refused, the legacy config copied first, a module's file and what overrides it said, and the harness model the session was opened with giving way to the file's, as the coding model does.
- `isChatEntry` checks what a record carries against its type, field by field: one another extension wrote under a name of turri's, or written wrong, is not turri's. Each entry's and message's schema matches its type exactly, or the core does not compile.
- `sideEffects: false`: no entry does anything as it is imported.
- `/plain` loads no pi: an editor reads, highlights and checks \*\*\*plain with no agent runtime.

### Fixed

- A pulse that stopped at its tests is said to have stopped there: `stoppedAt` reaches its job, and a job that failed for good keeps its last attempt's details.
- A front end's question dialog declined while it opened is closed.
- A listener's throw reaches `process.emitWarning` coded `TURRI_LISTENER`, as documented: given the error itself, Node dropped the code.
- Importing the core set exit, SIGINT, SIGTERM and SIGHUP handlers on the importing process; they are set once turri first starts a process group.
- Fresh and resumed captures run on the project's init-config models; init-config sets all three capture models and keeps a `models:` block valid.

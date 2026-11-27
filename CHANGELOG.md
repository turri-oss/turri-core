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
- **The check, by domain:** `checkPlainFile` and `checkPlainTargets` (`/plain`) are the \*\*\*plain language's check alone. What the project says of a module - two config files among those it requires, the steps of adding tests it skipped, a base folder not there - is `checkModule` and `checkModules` (`/project`), the check `turri parse` runs.
- `chats.restore` reopens a run's chats except those open already, replacing `skipFirst`. `Chat.stop()` never ends the session: what a front end's interrupt does beyond it is its own.

### Added

- A session's work loop runs with no chat open, on the config's models: the coding model builds, the harness model plans.
- A fresh chat of the person's starts on the project's harness model.
- `launches.followLogs` and `followLaunchedLogs` stop on a signal.
- `/plain` loads no pi: an editor reads, highlights and checks \*\*\*plain with no agent runtime.

### Fixed

- A pulse that stopped at its tests is said to have stopped there: `stoppedAt` reaches its job, and a job that failed for good keeps its last attempt's details.
- A front end's question dialog declined while it opened is closed.
- Fresh and resumed captures run on the project's init-config models; init-config sets all three capture models and keeps a `models:` block valid.

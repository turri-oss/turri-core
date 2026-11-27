# @turri-dev/core

**turri** is the first coding agent with the power of [regenerative software](https://chadfowler.com/regenerative-software/): you maintain the system's definition in [\*\*\*plain](https://plainlang.org/), and **turri** regenerates the code from it and proves the code conforms to it.

This is **turri**'s core: everything that decides and does - the session and its chats, the work loop, its pulses and their agents, the sandbox, launch, capture, the ledger, the \*\*\*plain parser, the skills and rules in `genome/` and the standard library in `stdlib/` - built on [pi](https://pi.dev). It has no terminal UI and no command line: it is one interface every front end builds on - **turri**'s CLI, [turri desktop](https://github.com/turri-oss/turri-desktop), an editor's extension - or none, for unattended work. The CLI and turri desktop are moving onto it; until they do, both import turri as `@turri-dev/cli`.

To use **turri**, install the CLI:

```bash
npm install -g @turri-dev/cli
turri doctor
```

## Entries

| import | what |
| --- | --- |
| `@turri-dev/core` | `createTurri`: the session for any front end - its chats, work, launches, sentinel, settings and skills, its typed events and data |
| `@turri-dev/core/plain` | the \*\*\*plain language: parse, check, graph, concepts, highlighting, the standard library |
| `@turri-dev/core/project` | a project on disk with no session: config and settings, a first config, standing and drift, history, the ledger, capture |
| `@turri-dev/core/models` | vendors, Amazon Bedrock, pi's model catalogue, the providers signed in to |
| `@turri-dev/core/system` | the machine: `doctor`, the Node check, the core's version |

```ts
import { createTurri } from "@turri-dev/core";

const turri = await createTurri({ frontend: { surface: "the app's own words for its views", shows: { pulseEnds: true } } });
turri.on("job", ({ job, final }) => { if (final) console.log(job.id, job.status); });
const chat = await turri.chats.open();
await chat.session.prompt("Build the todo app");
```

The package is ESM only, with TypeScript declarations, for Node 22.19 or newer. A front end and the core share one `@earendil-works/pi-coding-agent` peer (1.6.0). The harness uses git and bash. A 0.x release may change the API - see [the core](docs/core.md) for the whole interface and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Working on it

```bash
git clone <this repository> && cd turri-core
npm install
npm run typecheck   # src/ only, not tests/
npm test            # the whole suite, about a minute - calls no model
```

The TypeScript runs unbuilt, through Node's own type stripping. To try a change in the chat, link this clone into a clone of the CLI and start it with `NODE_OPTIONS=--conditions=turri-source`, so the core runs from `src/` - see [importing the core](docs/core.md#importing-the-core).

[The core](docs/core.md) is the interface: its entries, the session, the front end, its events, errors and versioning, and the boundary with what only a screen needs. [Development](docs/development.md) has the tests, the source layout and publishing; the other pages in [docs/](docs/README.md) say how each part behaves. Read [regenerating](docs/regenerating.md), [the sandbox](docs/sandbox.md) and [skills and gates](docs/skills-and-gates.md) before changing the harness, and [contributing](CONTRIBUTING.md) before opening a pull request.

## License

turri is open source, under the [MIT licence](LICENSE).

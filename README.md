# @turri-dev/core

**turri** is the first coding agent with the power of [regenerative software](https://chadfowler.com/regenerative-software/): you maintain the system's definition in [\*\*\*plain](https://plainlang.org/), and **turri** regenerates the code from it and proves the code conforms to it.

This is **turri**'s core: everything that decides and does - the session and its chats, the work loop, its pulses and their agents, the sandbox, launch, capture, the ledger, the \*\*\*plain parser, the skills and rules in `genome/` and the standard library in `stdlib/` - built into [pi](https://pi.dev) as an extension. It has no terminal UI and no command line: those are **turri**'s CLI's. The CLI and [turri desktop](https://github.com/turri-oss/turri-desktop) (through `@turri-dev/core/host`) are to build on this package; until they move to it, both import turri as `@turri-dev/cli`.

To use **turri**, install the CLI:

```bash
npm install -g @turri-dev/cli
turri doctor
```

## Entries

| import | what |
| --- | --- |
| `@turri-dev/core` | `createTurri`: a project's chats, live work, plan previews and typed session events |
| `@turri-dev/core/host` | [desktop integration](docs/hosting.md): diagnostics, sign-in and saved conversations |
| `@turri-dev/core/plain` | parse, check, highlight and explore a project's specs, including their standing on disk |
| `@turri-dev/core/config` | read settings and models, and initialise a project |
| `@turri-dev/core/ledger` | observe events and read runs and pulses back |
| `@turri-dev/core/terminal` | the pi extension, terminal driver and view hooks |
| `@turri-dev/core/commands` | unattended runs and the operations behind the CLI commands |
| `@turri-dev/core/startup` | Node checks, package identity and launch settings before loading pi |

The package is ESM only, with TypeScript declarations, for Node 22.19 or newer. The host and the core use one `@earendil-works/pi-coding-agent` peer (1.6.0). The harness uses git and bash. A 0.x release may change the API.

## Working on it

```bash
git clone <this repository> && cd turri-core
npm install
npm run typecheck   # src/ only, not tests/
npm test            # the whole suite, about a minute - calls no model
```

The TypeScript runs unbuilt, through Node's own type stripping. To try a change in the chat, link this clone into a clone of the CLI and start it with `NODE_OPTIONS=--conditions=turri-source`, so the core runs from `src/` - see [importing the core](docs/core.md#importing-the-core).

[The core](docs/core.md) says what is the core's and what is the CLI's, and how they meet: the boundary, the view, the entries a chat keeps and unattended runs. [Development](docs/development.md) has the tests, the source layout and publishing; the other pages in [docs/](docs/README.md) say how each part behaves. Read [regenerating](docs/regenerating.md), [the sandbox](docs/sandbox.md) and [skills and gates](docs/skills-and-gates.md) before changing the harness, and [contributing](CONTRIBUTING.md) before opening a pull request.

## License

turri is open source, under the [MIT licence](LICENSE).

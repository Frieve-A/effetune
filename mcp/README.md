# effetune-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant drive a running
[EffeTune](https://effetune.frieve.com) desktop app: read and edit the effect pipeline, change
parameters, and load or save presets. It talks to the app over its LAN Remote Control API
([remote-v1](https://github.com/Frieve-A/effetune/blob/main/docs/remote-v1.md)); the audio stays in EffeTune.

The server knows no effect by name. It asks the connected app which effects it has and which
parameters they take (`describeEffects`), so effects added in a later EffeTune release can be
used without updating this package.

## Requirements

- Node.js 20 or later
- EffeTune desktop app with **Settings > Remote Control...** switched on. Parameter
  descriptions (`describe_effects`) need an EffeTune build that advertises the `describe1`
  feature; with an older one every other tool still works.

## Setup

You can ask a local AI agent such as Codex or Claude Code to handle installation and registration.
The [EffeTune user guide](https://github.com/Frieve-A/effetune#control-effetune-with-an-ai-assistant-mcp)
provides a prompt you can copy; translated prompts are in each language's user guide.
Give the agent the pairing link and have it configure only the client you use, preserving other
MCP settings. Once the client loads the new tools, verify with `connection_info` and `get_pipeline`
without changing the pipeline. A restart or a new chat may be needed before the tools appear.

The `npx` instructions below require a published `effetune-mcp` npm package. If npm reports that
the package cannot be found, use [Local-source setup](#local-source-setup).

Copy the pairing link from the Remote Control window (**Copy link**), for example
`http://192.168.1.10:47300/?t=0123abcd...`, then run:

```sh
npx -y effetune-mcp setup
```

It asks for the link, checks it against the running app (version and features are shown), and
registers the `effetune` server in the clients it finds: **Claude Code** (`claude mcp add -s user`),
**Codex** (`codex mcp add`) and **Claude Desktop** (`mcpServers` in `claude_desktop_config.json`;
other entries are kept and the previous file is saved as `.bak`). An existing `effetune` entry is
replaced only after you confirm. Rerun it after **New token** or when the port changes.

| Option | Meaning |
|---|---|
| `--url <link>` | The pairing link, instead of being asked (or set `EFFETUNE_URL`) |
| `--client <list>` | Comma-separated `claude-code`, `codex`, `claude-desktop` |
| `--yes` | Register in every client found and replace existing entries without asking |

This package runs as a local stdio MCP server. The client must be able to launch a local process
and reach EffeTune on your network; this package does not provide a public HTTPS MCP endpoint.

### Manual setup

Pass the link as `EFFETUNE_URL`. On Windows, use `cmd /c npx -y effetune-mcp` as the command.

Claude Code:

```sh
claude mcp add effetune --env EFFETUNE_URL="http://192.168.1.10:47300/?t=<token>" -- npx -y effetune-mcp
```

Codex:

```sh
codex mcp add effetune --env EFFETUNE_URL="http://192.168.1.10:47300/?t=<token>" -- npx -y effetune-mcp
```

Claude Desktop and other clients (`mcpServers` in the client's config file):

```json
{
  "mcpServers": {
    "effetune": {
      "command": "npx",
      "args": ["-y", "effetune-mcp"],
      "env": { "EFFETUNE_URL": "http://192.168.1.10:47300/?t=<token>" }
    }
  }
}
```

When the app picks another port or you press **New token**, update the link. The link can also be
given as the first argument, but other users of the computer can read command lines; prefer
`EFFETUNE_URL`.

### Local-source setup

Use Node.js 20 or later and Git. Keep this checkout in a permanent folder, since the client will
launch the server from it. Only the `mcp` directory and its dependencies are needed to run it:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/Frieve-A/effetune.git effetune-mcp-source
git -C effetune-mcp-source sparse-checkout set mcp
npm --prefix effetune-mcp-source/mcp ci --ignore-scripts
```

Register the server in the client you use. Replace the example link and the absolute path below
with your pairing link and the location of `mcp/src/index.mjs`. These commands launch `node`
directly on Windows, macOS, and Linux:

```sh
# Codex
codex mcp add effetune --env EFFETUNE_URL="http://192.168.1.10:47300/?t=<token>" -- node "/absolute/path/effetune-mcp-source/mcp/src/index.mjs"

# Claude Code
claude mcp add --scope user --env EFFETUNE_URL="http://192.168.1.10:47300/?t=<token>" --transport stdio effetune -- node "/absolute/path/effetune-mcp-source/mcp/src/index.mjs"
```

If `effetune` is already registered, update that entry while keeping other MCP servers. If the
Codex CLI is unavailable, the same `command`, `args`, and `env` can be set in its MCP configuration;
see the [Codex MCP guide](https://developers.openai.com/codex/mcp/).
Claude Code's registration options are documented in its [MCP guide](https://code.claude.com/docs/en/mcp).
For Claude Desktop, use the JSON above with `"command": "node"` and `"args"` containing only the
absolute path to `mcp/src/index.mjs`. Use forward slashes in Windows JSON paths, such as
`C:/Users/YourName/effetune-mcp-source/mcp/src/index.mjs`.

Do not run the `setup` subcommand for a local-source installation: it registers the npm launch
command. Restart the client if necessary, then check `connection_info` and `get_pipeline`.

## Tools

| Tool | What it does |
|---|---|
| `get_pipeline` | The active pipeline: stages with index, `nm`, `en` and parameter values, A/B slot, master bypass |
| `list_effects` | Effects the app can load, with category |
| `describe_effects` | Keys, types, defaults and ranges/options of the named effects |
| `set_params` | Change keys of one stage (also `en`, `ch`, `ib`, `ob`) |
| `add_effect` / `remove_effect` / `move_effect` | Edit stages by index |
| `set_pipeline` | Replace the whole pipeline |
| `set_master_bypass` | Master bypass on/off |
| `list_presets` / `get_preset` / `load_preset` / `save_preset` | Stored presets |
| `undo` / `redo` | The app's global undo history |
| `switch_slot` / `copy_slot` | A/B pipelines |
| `raw_request` | Any remote-v1 request, for ops newer than this server. Only offered with `EFFETUNE_MCP_ALLOW_RAW=1`, since it can also delete presets |
| `connection_info` | App version, host name and protocol features |

Tools that need a protocol extension report it when the app does not support it. Every tool carries
MCP annotations (`readOnlyHint`, `destructiveHint`), so clients can ask before tools that replace or
delete something.

## Security

The token in the link is the only credential and the traffic is plain `ws://`. Use it on a
network you trust, keep the link private, and press **New token** in EffeTune to revoke it.

Tool results include text that anyone holding the link can write, such as preset names and
Section comments. The server tells the model to treat it as data, but keep your client's approval
prompts on for tools marked destructive, especially when other tools (files, shell) are available
in the same session.

## Development

The tests run the app's real WebSocket host (`electron/remote-control-host.cjs`) with a
stand-in renderer, so they need the repository's dependencies:

```sh
npm ci --ignore-scripts      # repository root
cd mcp && npm ci && npm test
```

Releases are published by `.github/workflows/mcp.yml` from a tag `mcp-v<version>` matching
`package.json`; see [RELEASING.md](https://github.com/Frieve-A/effetune/blob/main/mcp/RELEASING.md).

# effetune-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant drive a running
[EffeTune](https://effetune.frieve.com) desktop app: read and edit the effect pipeline, change
parameters, and load or save presets. It talks to the app over its LAN Remote Control API
([remote-v1](https://github.com/comoc/effetune/blob/main/docs/remote-v1.md)); the audio stays in EffeTune.

The server knows no effect by name. It asks the connected app which effects it has and which
parameters they take (`describeEffects`), so effects added in a later EffeTune release can be
used without updating this package.

## Requirements

- Node.js 20 or later
- EffeTune desktop app with **Settings > Remote Control...** switched on. Parameter
  descriptions (`describe_effects`) need an EffeTune build that advertises the `describe1`
  feature; with an older one every other tool still works.

## Setup

Copy the pairing link from the Remote Control window (**Copy link**), for example
`http://192.168.1.10:47300/?t=0123abcd...`, and pass it as `EFFETUNE_URL`.

Claude Code:

```sh
claude mcp add effetune --env EFFETUNE_URL="http://192.168.1.10:47300/?t=<token>" -- npx -y effetune-mcp
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
`package.json` (repository secret `NPM_TOKEN`).

# smarthome-port

smarthome-port talks to a Home Assistant instance through its
REST API. Everything in Home Assistant is an entity —
`light.kitchen`, `sensor.temp`, `switch.porch` — and the API
reflects that shape: you read entity states, call services on a
domain (`light.turn_on`, `switch.toggle`), look back at recent
history, read the core configuration, render Jinja templates on
the server, and fire events onto the event bus. smarthome-port
exposes those six operations, plus listings of entities and
services, through one binary that serves a command-line interface
and a stdio MCP server.

Two settings are required, and there is no built-in default for
either:

- `HOME_ASSISTANT_URL` — the base URL of the instance, for
  example `http://homeassistant.local:8123`. A trailing slash is
  stripped.
- `HOME_ASSISTANT_TOKEN` — a long-lived access token (create one
  in Home Assistant under your profile). It is sent as an
  `Authorization: Bearer` header and never appears in output.

When either variable is missing, every call fails with an error
that names the missing variable, before any request is made.

Only the REST API is covered. The websocket API is not
implemented.

## Install

```bash
npx @reneturcios/smarthome-port entities
```

Or run the container image:

```bash
docker run -i -e HOME_ASSISTANT_URL -e HOME_ASSISTANT_TOKEN ghcr.io/cloudcorprecords/smarthome-port
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
export HOME_ASSISTANT_URL=http://homeassistant.local:8123
export HOME_ASSISTANT_TOKEN=<your long-lived access token>

smarthome-port entities
smarthome-port entities --domain light
smarthome-port state sensor.temp
smarthome-port call light turn_on --entity light.kitchen --data '{"brightness_pct":50}'
smarthome-port services
smarthome-port services --domain light
smarthome-port history sensor.temp --hours 6
smarthome-port config
smarthome-port render "{{ states('sensor.temp') }}"
smarthome-port fire my_event --data '{"device":"kitchen"}'

smarthome-port --version
```

Each command prints the upstream JSON payload (template rendering
prints `{"rendered": "..."}`). Exit codes: `0` on success, `1`
when a call fails (including missing configuration or an API
error), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/smarthome-port mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "smarthome-port": {
      "command": "npx",
      "args": ["-y", "@reneturcios/smarthome-port", "mcp"],
      "env": {
        "HOME_ASSISTANT_URL": "http://homeassistant.local:8123",
        "HOME_ASSISTANT_TOKEN": "..."
      }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `list_entities` | `domain` (optional) | Entity states, filtered client-side to one domain when given. |
| `get_entity_state` | `entity_id` (required) | The full state of one entity. |
| `call_service` | `domain`, `service` (required), `entity_id`, `service_data` (optional) | The service call result; `service_data` is merged with `entity_id`. |
| `list_services` | `domain` (optional) | Services by domain, or only one domain's entry when given. |
| `get_history` | `entity_id` (required), `hours` (optional, default 24) | Recent history for the entity over the window ending now. |
| `get_config` | (none) | The core configuration. |
| `render_template` | `template` (required) | `{"rendered": "..."}` — the upstream reply is plain text. |
| `fire_event` | `event_type` (required), `event_data` (optional) | The upstream reply; `event_data` defaults to `{}`. |

All calls go to `{HOME_ASSISTANT_URL}/api`. An `entity_id` must
contain a dot (`domain.object_id`), and `domain`, `service`, and
`event_type` must be non-empty — both are checked before any
request. History timestamps are computed client-side from the
current time. HTTP failures surface the status plus the upstream
`message` when Home Assistant provides one.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.

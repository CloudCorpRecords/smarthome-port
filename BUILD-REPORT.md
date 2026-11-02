# smarthome-port — Build Report

MCP Rebuild 100. Clean-room rebuild of the home-assistant target,
built from the public Home Assistant REST API documentation
captured in `harness/fixtures/home-assistant-tools-original.json`
only. The fixture was created for this build from the public
Home Assistant REST API docs (/api/states, /api/services,
/api/history, /api/config, /api/template, /api/events;
2026-10-26), marked `"_source": fill-in spec ... labelled
fill-in`. home-assistant is a TARGETS.json fill-in with
`source_repo: null` — no original server was probed; parity
proves the rebuild matches this program's defined spec, labelled
fill-in. Local build only — nothing pushed or published, and no
live network call was made or claimed at any point.

Identity: repo `smarthome-port`, npm `@reneturcios/smarthome-port`,
MCP name `io.github.CloudCorpRecords/smarthome-port`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `smarthome-port: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Home Assistant control: entity
  states, services, history, config, templates, and events." =
  **88 chars** (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/smarthome-port:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/smarthome-port"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`entities`, `state`, `call`,
  `services`, `history`, `config`, `render`, `fire`, `mcp`,
  `--version`; exit 2 usage / 1 API error), `src/mcp.ts`,
  `src/types.ts`, `src/smarthome.ts` (core logic, `VERSION = "0.1.0"`)
- `test/smarthome.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to smarthome-port)

## Tools implemented (8)

`list_entities`, `get_entity_state`, `call_service`,
`list_services`, `get_history`, `get_config`, `render_template`,
`fire_event` — the full defined set in the fixture `_source`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the defined spec
  and break exact schema parity. Zod still validates every
  `tools/call`.
- Configuration is passed into the core functions as an env-shaped
  config object (`token`, `baseUrl`). Endpoints on `{base}/api`:
  `GET /states` (filtered client-side by domain prefix when a
  domain is given), `GET /states/{entity_id}`,
  `POST /services/{domain}/{service}` with a JSON body of
  `service_data` merged with `entity_id` when given,
  `GET /services` (when a domain is given, only that domain's entry
  is returned, as an array, or `[]`), `GET
  /history/period/{startISO}?filter_entity_id={id}&end_time={endISO}`
  with start = now − hours and end = now computed from `Date.now`
  as URL-encoded ISO strings, `GET /config`, `POST /template`
  (upstream returns plain text — handled with `text()`, returned
  as `{rendered: text}`), and `POST /events/{event_type}` with a
  JSON body of `event_data ?? {}`. The token is sent as
  `Authorization: Bearer`; a trailing slash on the base URL is
  stripped.
- Validation before any request: an `entity_id` must contain a
  dot, and `domain` / `service` / `event_type` must be non-empty.
  `get_history` defaults `hours` to 24 when not given.
- HTTP failures surface the status plus the upstream `message`
  when its JSON error body provides one; `render_template` errors
  surface the status. Missing configuration throws before any
  request, naming `HOME_ASSISTANT_TOKEN` first and then
  `HOME_ASSISTANT_URL` (which has no default); over MCP both
  surface as `isError` results (verified live over stdio, below).
- All HTTP flows through an injectable `FetchFn` (types.ts). The
  test suite uses a fake fetch returning hand-written
  Home-Assistant-shaped fixtures — **no live call was performed**.

## Verification (foreground, exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 16
ℹ pass 16
ℹ fail 0
```
Covers: missing token naming HOME_ASSISTANT_TOKEN with no request
made, missing URL naming HOME_ASSISTANT_URL with no request made,
trailing-slash stripping, list filtered by domain, get-state path,
call_service body merging service_data + entity_id and its path,
empty domain/service rejection, list_services domain filter
(including the `[]` case), history URL containing
filter_entity_id and end_time with the correct 6-hour span, config
path, render_template posting and returning the plain-text reply
as `rendered`, render_template HTTP error surfacing the status,
fire_event body defaulting to `{}`, an entity_id without a dot
erroring before any request, and HTTP errors carrying the
upstream `message`.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"smarthome-port",
"version":"0.1.0"}`. A `tools/call` for `get_config` with
`HOME_ASSISTANT_TOKEN` unset returned `isError: true` with text
"HOME_ASSISTANT_TOKEN environment variable is required: set
HOME_ASSISTANT_TOKEN to a Home Assistant long-lived access token
and retry". A second `tools/call` for `list_entities` with
`HOME_ASSISTANT_TOKEN` set but `HOME_ASSISTANT_URL` unset returned
`isError: true` with text "HOME_ASSISTANT_URL environment variable
is required: set HOME_ASSISTANT_URL to the Home Assistant base URL
(e.g. http://homeassistant.local:8123) and retry". Live API calls
were **not** run (no live Home Assistant instance, egress blocked).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/home-assistant-tools-original.json \
    --rebuild "stdio:node .../builds/smarthome-port/dist/cli.js mcp" \
    --out .../builds/smarthome-port/parity-out
verdict=PASS parity_pct=100.0 original_tools=8 rebuild_tools=8 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 8/8.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from modelrun's and its identity
fields edited (top-level `name`, root package `name`, root package
`bin` key → smarthome-port; dependency ranges are identical, so the
tree is unchanged). **Clean lockfile regen required before publish**
(regenerate with no `node_modules` present); do not publish from
this lockfile as-is. `node_modules` here is a copy of modelrun's;
`.bin/tsc` / `.bin/tsx` verified working after the chmod fix.

## Gaps / honest notes

- Fill-in spec: home-assistant is a TARGETS.json fill-in with
  `source_repo: null`. There is no original server to probe, so
  parity proves the rebuild matches this program's defined spec
  (derived from the public Home Assistant REST API docs), not a
  hand-probed original.
- No live Home Assistant instance or call: no instance exists in
  this VM and egress is blocked, so request construction and
  response handling are proven against fake fetches only; live
  payload/response-shape drift is unverified until the publish
  wave can smoke against a real instance.
- Websocket API not implemented: Home Assistant also exposes a
  websocket API; smarthome-port implements the REST API only,
  matching the defined spec.
- History timestamps are computed client-side: the history window
  (start = now − hours, end = now) is derived from `Date.now` on
  the client, so clock skew between the client and the Home
  Assistant instance shifts the window.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.

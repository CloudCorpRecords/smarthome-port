# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `smarthome-port entities|state|call|services|history|config|render|fire`
  and `smarthome-port mcp`; configuration is read from
  `HOME_ASSISTANT_TOKEN` and `HOME_ASSISTANT_URL`.
- MCP server (`smarthome-port mcp`, stdio) with eight tools:
  `list_entities`, `get_entity_state`, `call_service`,
  `list_services`, `get_history`, `get_config`, `render_template`,
  and `fire_event`.
- Calls go to the Home Assistant REST API under
  `{HOME_ASSISTANT_URL}/api` with the token sent as an
  `Authorization: Bearer` header; a trailing slash on the base URL
  is stripped, and HTTP failures surface the status plus the
  upstream `message` when one is provided.
- `list_entities` filters states client-side by domain;
  `list_services` can return only one domain's entry;
  `render_template` returns the upstream plain-text reply as
  `{"rendered": "..."}`; `fire_event` defaults its body to `{}`.
- Missing `HOME_ASSISTANT_TOKEN` or `HOME_ASSISTANT_URL` fails
  honestly with an error naming the variable, before any request
  is made. The websocket API is not implemented (REST only).
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.

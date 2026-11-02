/**
 * smarthome-port core: eight tools against the Home Assistant
 * REST API.
 *
 * The base URL comes from HOME_ASSISTANT_URL (for example
 * http://homeassistant.local:8123 — there is no default) and the
 * long-lived access token from HOME_ASSISTANT_TOKEN, sent as
 * `Authorization: Bearer`. A trailing slash on the base URL is
 * stripped. Endpoints, on {base}/api:
 *
 *   list_entities    GET  /states (filtered client-side by domain)
 *   get_entity_state GET  /states/{entity_id}
 *   call_service     POST /services/{domain}/{service}
 *   list_services    GET  /services (filtered to one domain if given)
 *   get_history      GET  /history/period/{start}?filter_entity_id=..&end_time=..
 *   get_config       GET  /config
 *   render_template  POST /template (upstream replies plain text)
 *   fire_event       POST /events/{event_type}
 *
 * Missing configuration is an error before any request, naming the
 * missing variable (HOME_ASSISTANT_TOKEN first, then
 * HOME_ASSISTANT_URL). HTTP failures surface the status plus the
 * upstream `message` when its JSON error body provides one.
 * All HTTP goes through an injected FetchFn so everything is
 * testable offline.
 */
import type {
  CallServiceOptions,
  FetchFn,
  FireEventOptions,
  GetEntityStateOptions,
  GetHistoryOptions,
  ListEntitiesOptions,
  ListServicesOptions,
  RenderTemplateOptions,
  SmarthomeConfig,
} from "./types.js";

export const VERSION = "0.1.0";

export const TOKEN_ENV = "HOME_ASSISTANT_TOKEN";
export const URL_ENV = "HOME_ASSISTANT_URL";

/** Resolve config, naming the first missing variable. */
export function requireConfig(config: SmarthomeConfig): { token: string; baseUrl: string } {
  const token = typeof config.token === "string" ? config.token.trim() : "";
  if (!token) {
    throw new Error(
      "HOME_ASSISTANT_TOKEN environment variable is required: set HOME_ASSISTANT_TOKEN to a Home Assistant long-lived access token and retry",
    );
  }
  const rawUrl = typeof config.baseUrl === "string" ? config.baseUrl.trim() : "";
  if (!rawUrl) {
    throw new Error(
      "HOME_ASSISTANT_URL environment variable is required: set HOME_ASSISTANT_URL to the Home Assistant base URL (e.g. http://homeassistant.local:8123) and retry",
    );
  }
  return { token, baseUrl: rawUrl.replace(/\/+$/, "") };
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function requireEntityId(value: unknown): string {
  const v = requireNonEmpty(value, "entity_id");
  if (!v.includes(".")) {
    throw new Error(`entity_id must contain a dot (domain.object_id), got: ${v}`);
  }
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

interface CallInit {
  method?: string;
  body?: unknown;
}

async function request(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  path: string,
  init: CallInit = {},
): Promise<{ response: { ok: boolean; status: number; statusText?: string; text(): Promise<string>; json(): Promise<unknown> } }> {
  const { token, baseUrl } = requireConfig(config);
  let response;
  try {
    response = await fetchFn(`${baseUrl}/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Home Assistant API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { response };
}

async function callJson(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  path: string,
  init: CallInit = {},
): Promise<unknown> {
  const { response } = await request(fetchFn, config, path, init);
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.message === "string" && payload.message) {
        detail = `: ${payload.message}`;
      }
    } catch {
      // A non-JSON error body still reports its HTTP status below.
    }
    throw new Error(
      `Home Assistant API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Home Assistant API returned a response that was not valid JSON");
  }
}

/** List entity states, optionally only one domain (client-side filter). */
export async function listEntities(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: ListEntitiesOptions = {},
): Promise<unknown> {
  const domain = options.domain ? requireNonEmpty(options.domain, "domain") : undefined;
  const payload = await callJson(fetchFn, config, "/states");
  if (!domain) return payload;
  if (!Array.isArray(payload)) return payload;
  return payload.filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry.entity_id === "string" &&
      entry.entity_id.split(".")[0] === domain,
  );
}

/** Get the full state of one entity. */
export async function getEntityState(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: GetEntityStateOptions,
): Promise<unknown> {
  const entityId = requireEntityId(options.entity_id);
  return callJson(fetchFn, config, `/states/${seg(entityId)}`);
}

/** Call a service, merging service_data with the target entity_id. */
export async function callService(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: CallServiceOptions,
): Promise<unknown> {
  const domain = requireNonEmpty(options.domain, "domain");
  const service = requireNonEmpty(options.service, "service");
  const body: Record<string, unknown> = { ...(options.service_data ?? {}) };
  if (options.entity_id !== undefined) body.entity_id = requireEntityId(options.entity_id);
  return callJson(fetchFn, config, `/services/${seg(domain)}/${seg(service)}`, {
    method: "POST",
    body,
  });
}

/** List services, optionally only one domain's entry. */
export async function listServices(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: ListServicesOptions = {},
): Promise<unknown> {
  const domain = options.domain ? requireNonEmpty(options.domain, "domain") : undefined;
  const payload = await callJson(fetchFn, config, "/services");
  if (!domain) return payload;
  if (!Array.isArray(payload)) return payload;
  return payload.filter((entry) => isRecord(entry) && entry.domain === domain);
}

/** Get recent history for one entity over the given number of hours. */
export async function getHistory(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: GetHistoryOptions,
): Promise<unknown> {
  const entityId = requireEntityId(options.entity_id);
  const hours = options.hours ?? 24;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    throw new Error("hours must be a positive number");
  }
  const end = new Date(Date.now());
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const startISO = start.toISOString();
  const endISO = end.toISOString();
  const params = new URLSearchParams();
  params.set("filter_entity_id", entityId);
  params.set("end_time", endISO);
  return callJson(
    fetchFn,
    config,
    `/history/period/${encodeURIComponent(startISO)}?${params.toString()}`,
  );
}

/** Get the Home Assistant core configuration. */
export async function getConfig(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
): Promise<unknown> {
  return callJson(fetchFn, config, "/config");
}

/** Render a Jinja template; upstream returns plain text, not JSON. */
export async function renderTemplate(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: RenderTemplateOptions,
): Promise<{ rendered: string }> {
  const template = requireNonEmpty(options.template, "template");
  const { response } = await request(fetchFn, config, "/template", {
    method: "POST",
    body: { template },
  });
  if (!response.ok) {
    throw new Error(
      `Home Assistant API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  return { rendered: await response.text() };
}

/** Fire an event on the event bus. */
export async function fireEvent(
  fetchFn: FetchFn,
  config: SmarthomeConfig,
  options: FireEventOptions,
): Promise<unknown> {
  const eventType = requireNonEmpty(options.event_type, "event_type");
  return callJson(fetchFn, config, `/events/${seg(eventType)}`, {
    method: "POST",
    body: options.event_data ?? {},
  });
}

/** Render an upstream payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

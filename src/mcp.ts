/**
 * smarthome-port MCP server. Tools: list_entities, get_entity_state,
 * call_service, list_services, get_history, get_config,
 * render_template, fire_event.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set.
 *
 * Configuration is read at call time: HOME_ASSISTANT_TOKEN (long-lived
 * access token) and HOME_ASSISTANT_URL (base URL, no default). A
 * missing variable returns an honest isError result naming it instead
 * of failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  callService,
  fireEvent,
  formatPayload,
  getConfig,
  getEntityState,
  getHistory,
  listEntities,
  listServices,
  renderTemplate,
  TOKEN_ENV,
  URL_ENV,
  VERSION,
} from "./smarthome.js";
import type { FetchFn, SmarthomeConfig } from "./types.js";

const NoArgs = z.object({});
const ListEntitiesArgs = z.object({ domain: z.string().optional() });
const GetEntityStateArgs = z.object({ entity_id: z.string() });
const CallServiceArgs = z.object({
  domain: z.string(),
  service: z.string(),
  entity_id: z.string().optional(),
  service_data: z.record(z.string(), z.unknown()).optional(),
});
const ListServicesArgs = z.object({ domain: z.string().optional() });
const GetHistoryArgs = z.object({
  entity_id: z.string(),
  hours: z.number().optional(),
});
const RenderTemplateArgs = z.object({ template: z.string() });
const FireEventArgs = z.object({
  event_type: z.string(),
  event_data: z.record(z.string(), z.unknown()).optional(),
});

const TOOLS = [
  {
    name: "list_entities",
    description: "List entity states from Home Assistant, optionally only one domain (the part before the dot).",
    inputSchema: {
      type: "object" as const,
      properties: { domain: { type: "string", description: "Optional domain (the part of an entity_id before the dot, e.g. 'light') to filter listed entities to." } },
    },
  },
  {
    name: "get_entity_state",
    description: "Get the full state of one entity by entity_id.",
    inputSchema: {
      type: "object" as const,
      properties: { entity_id: { type: "string", description: "The entity_id of the entity to retrieve, in 'domain.object_id' format (must contain a dot)." } },
      required: ["entity_id"],
    },
  },
  {
    name: "call_service",
    description: "Call a Home Assistant service, e.g. domain light, service turn_on, with an optional target entity and service data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string", description: "The service domain to call (e.g. 'light')." },
        service: { type: "string", description: "The service name to call within the domain (e.g. 'turn_on')." },
        entity_id: { type: "string", description: "Optional target entity_id for the service call, in 'domain.object_id' format (must contain a dot)." },
        service_data: { type: "object", description: "Optional additional service data object merged into the service call body." },
      },
      required: ["domain", "service"],
    },
  },
  {
    name: "list_services",
    description: "List the services Home Assistant exposes, optionally only one domain.",
    inputSchema: {
      type: "object" as const,
      properties: { domain: { type: "string", description: "Optional domain to filter listed services to (only that domain's entry is returned)." } },
    },
  },
  {
    name: "get_history",
    description: "Get recent state history for one entity over the given number of hours.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "The entity_id whose history to retrieve, in 'domain.object_id' format (must contain a dot)." },
        hours: { type: "number", description: "Optional number of hours of history to retrieve, ending now (default 24; must be a positive number)." },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "get_config",
    description: "Get the Home Assistant core configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "render_template",
    description: "Render a Jinja template through Home Assistant and return the rendered text.",
    inputSchema: {
      type: "object" as const,
      properties: { template: { type: "string", description: "The Jinja template string to render through Home Assistant." } },
      required: ["template"],
    },
  },
  {
    name: "fire_event",
    description: "Fire an event on the Home Assistant event bus.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_type: { type: "string", description: "The type name of the event to fire on the Home Assistant event bus." },
        event_data: { type: "object", description: "Optional data object to attach to the fired event (defaults to an empty object)." },
      },
      required: ["event_type"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

function configFromEnv(): SmarthomeConfig {
  return {
    token: process.env[TOKEN_ENV],
    baseUrl: process.env[URL_ENV],
  };
}

const server = new Server(
  { name: "smarthome-port", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config = configFromEnv();
  try {
    let out: unknown;
    if (name === "list_entities") {
      out = await listEntities(fetchFn, config, ListEntitiesArgs.parse(args ?? {}));
    } else if (name === "get_entity_state") {
      out = await getEntityState(fetchFn, config, GetEntityStateArgs.parse(args ?? {}));
    } else if (name === "call_service") {
      out = await callService(fetchFn, config, CallServiceArgs.parse(args ?? {}));
    } else if (name === "list_services") {
      out = await listServices(fetchFn, config, ListServicesArgs.parse(args ?? {}));
    } else if (name === "get_history") {
      out = await getHistory(fetchFn, config, GetHistoryArgs.parse(args ?? {}));
    } else if (name === "get_config") {
      NoArgs.parse(args ?? {});
      out = await getConfig(fetchFn, config);
    } else if (name === "render_template") {
      out = await renderTemplate(fetchFn, config, RenderTemplateArgs.parse(args ?? {}));
    } else if (name === "fire_event") {
      out = await fireEvent(fetchFn, config, FireEventArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();

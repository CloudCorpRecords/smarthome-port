#!/usr/bin/env node
/**
 * smarthome-port CLI.
 *
 *   smarthome-port entities [--domain d]
 *   smarthome-port state <entity_id>
 *   smarthome-port call <domain> <service> [--entity id] [--data json]
 *   smarthome-port services [--domain d]
 *   smarthome-port history <entity_id> [--hours n]
 *   smarthome-port config
 *   smarthome-port render <template>
 *   smarthome-port fire <event_type> [--data json]
 *   smarthome-port mcp
 *
 * Reads HOME_ASSISTANT_TOKEN and HOME_ASSISTANT_URL.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
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

function usage(): never {
  console.error(`Usage:
  smarthome-port entities [--domain d]
  smarthome-port state <entity_id>
  smarthome-port call <domain> <service> [--entity id] [--data json]
  smarthome-port services [--domain d]
  smarthome-port history <entity_id> [--hours n]
  smarthome-port config
  smarthome-port render <template>
  smarthome-port fire <event_type> [--data json]
  smarthome-port mcp
  smarthome-port --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function withoutFlags(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) usage();
  try {
    const parsed: unknown = JSON.parse(raw as string);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("error: --data must be a JSON object");
      process.exit(2);
    }
    return parsed as Record<string, unknown>;
  } catch {
    console.error("error: argument is not valid JSON");
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config: SmarthomeConfig = {
    token: process.env[TOKEN_ENV],
    baseUrl: process.env[URL_ENV],
  };
  const known = [
    "entities", "state", "call", "services", "history", "config", "render", "fire",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "entities") {
      out = await listEntities(fetchFn, config, { domain: flagValue(rest, "--domain") });
    } else if (cmd === "state") {
      if (!rest[0]) usage();
      out = await getEntityState(fetchFn, config, { entity_id: rest[0] });
    } else if (cmd === "call") {
      const pos = withoutFlags(rest, ["--entity", "--data"]);
      if (!pos[0] || !pos[1]) usage();
      const dataRaw = flagValue(rest, "--data");
      out = await callService(fetchFn, config, {
        domain: pos[0],
        service: pos[1],
        entity_id: flagValue(rest, "--entity"),
        service_data: dataRaw ? parseJsonObject(dataRaw) : undefined,
      });
    } else if (cmd === "services") {
      out = await listServices(fetchFn, config, { domain: flagValue(rest, "--domain") });
    } else if (cmd === "history") {
      if (!rest[0]) usage();
      const hoursRaw = flagValue(rest, "--hours");
      out = await getHistory(fetchFn, config, {
        entity_id: rest[0],
        hours: hoursRaw ? Number(hoursRaw) : undefined,
      });
    } else if (cmd === "config") {
      out = await getConfig(fetchFn, config);
    } else if (cmd === "render") {
      if (!rest[0]) usage();
      out = await renderTemplate(fetchFn, config, { template: rest.join(" ") });
    } else {
      if (!rest[0]) usage();
      const pos = withoutFlags(rest, ["--data"]);
      if (!pos[0]) usage();
      const dataRaw = flagValue(rest, "--data");
      out = await fireEvent(fetchFn, config, {
        event_type: pos[0],
        event_data: dataRaw ? parseJsonObject(dataRaw) : undefined,
      });
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();

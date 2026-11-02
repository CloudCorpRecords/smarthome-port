import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  callService,
  fireEvent,
  getConfig,
  getEntityState,
  getHistory,
  listEntities,
  listServices,
  renderTemplate,
  requireConfig,
} from "../src/smarthome.js";
import type { FetchFn, HttpResponse, SmarthomeConfig } from "../src/types.js";

const CFG: SmarthomeConfig = { token: "tok123", baseUrl: "http://homeassistant.local:8123" };

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function textResponse(body: string, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "text/plain" },
    text: async () => body,
    json: async () => {
      throw new Error("not json");
    },
  };
}

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(captured: Captured, body: unknown = []): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured.url = url;
    captured.method = init?.method;
    captured.headers = init?.headers;
    captured.body = init?.body;
    return jsonResponse(body);
  };
}

describe("config", () => {
  it("missing token names HOME_ASSISTANT_TOKEN and makes no request", async () => {
    assert.throws(() => requireConfig({ baseUrl: "http://x:8123" }), /HOME_ASSISTANT_TOKEN/);
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse([]);
    };
    await assert.rejects(() => listEntities(spy, { baseUrl: "http://x:8123" }), /HOME_ASSISTANT_TOKEN/);
    assert.equal(called, false);
  });

  it("missing URL names HOME_ASSISTANT_URL and makes no request", async () => {
    assert.throws(() => requireConfig({ token: "t" }), /HOME_ASSISTANT_URL/);
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => getConfig(spy, { token: "t" }), /HOME_ASSISTANT_URL/);
    assert.equal(called, false);
  });

  it("strips a trailing slash on the base URL", async () => {
    const captured: Captured = {};
    await getConfig(fakeFetch(captured, { version: "2026.1" }), {
      token: "t",
      baseUrl: "http://homeassistant.local:8123/",
    });
    assert.equal(captured.url, "http://homeassistant.local:8123/api/config");
  });
});

describe("entities", () => {
  it("lists entities and filters client-side by domain", async () => {
    const states = [
      { entity_id: "light.kitchen", state: "on" },
      { entity_id: "switch.porch", state: "off" },
      { entity_id: "light.living", state: "off" },
    ];
    const all: Captured = {};
    const allOut = (await listEntities(fakeFetch(all, states), CFG)) as unknown[];
    assert.equal(allOut.length, 3);
    assert.equal(new URL(all.url ?? "").pathname, "/api/states");
    assert.equal(all.headers?.Authorization, "Bearer tok123");
    const filtered = (await listEntities(fakeFetch({}, states), CFG, { domain: "light" })) as {
      entity_id: string;
    }[];
    assert.deepEqual(
      filtered.map((e) => e.entity_id),
      ["light.kitchen", "light.living"],
    );
  });

  it("gets one entity state by path", async () => {
    const captured: Captured = {};
    const out = (await getEntityState(fakeFetch(captured, { entity_id: "sensor.temp", state: "21" }), CFG, {
      entity_id: "sensor.temp",
    })) as { state: string };
    assert.equal(out.state, "21");
    assert.equal(new URL(captured.url ?? "").pathname, "/api/states/sensor.temp");
    assert.equal(captured.method, "GET");
  });

  it("rejects an entity_id without a dot before any request", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => getEntityState(spy, CFG, { entity_id: "nodot" }), /entity_id must contain a dot/);
    await assert.rejects(() => getHistory(spy, CFG, { entity_id: "nodot" }), /entity_id must contain a dot/);
    assert.equal(called, false);
  });
});

describe("services", () => {
  it("call_service merges service_data and entity_id and posts to the service path", async () => {
    const captured: Captured = {};
    await callService(fakeFetch(captured, []), CFG, {
      domain: "light",
      service: "turn_on",
      entity_id: "light.kitchen",
      service_data: { brightness_pct: 50 },
    });
    assert.equal(new URL(captured.url ?? "").pathname, "/api/services/light/turn_on");
    assert.equal(captured.method, "POST");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), {
      brightness_pct: 50,
      entity_id: "light.kitchen",
    });
  });

  it("call_service rejects empty domain or service before any request", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse([]);
    };
    await assert.rejects(() => callService(spy, CFG, { domain: "", service: "turn_on" }), /domain must be a non-empty/);
    await assert.rejects(() => callService(spy, CFG, { domain: "light", service: " " }), /service must be a non-empty/);
    assert.equal(called, false);
  });

  it("list_services filters to only the requested domain's entry", async () => {
    const services = [
      { domain: "light", services: { turn_on: {} } },
      { domain: "switch", services: { toggle: {} } },
    ];
    const captured: Captured = {};
    const all = (await listServices(fakeFetch(captured, services), CFG)) as unknown[];
    assert.equal(all.length, 2);
    assert.equal(new URL(captured.url ?? "").pathname, "/api/services");
    const only = (await listServices(fakeFetch({}, services), CFG, { domain: "light" })) as {
      domain: string;
    }[];
    assert.deepEqual(only, [{ domain: "light", services: { turn_on: {} } }]);
    const none = (await listServices(fakeFetch({}, services), CFG, { domain: "climate" })) as unknown[];
    assert.deepEqual(none, []);
  });
});

describe("history, config, template, events", () => {
  it("get_history URL contains filter_entity_id and end_time", async () => {
    const captured: Captured = {};
    await getHistory(fakeFetch(captured, [[{ entity_id: "sensor.temp" }]]), CFG, {
      entity_id: "sensor.temp",
      hours: 6,
    });
    const url = new URL(captured.url ?? "");
    assert.ok(url.pathname.startsWith("/api/history/period/"));
    assert.equal(url.searchParams.get("filter_entity_id"), "sensor.temp");
    const end = url.searchParams.get("end_time");
    assert.ok(end, "end_time present");
    const startISO = decodeURIComponent(url.pathname.replace("/api/history/period/", ""));
    const spanMs = new Date(end as string).getTime() - new Date(startISO).getTime();
    assert.ok(Math.abs(spanMs - 6 * 60 * 60 * 1000) < 5000, `span ${spanMs}`);
  });

  it("get_config hits /api/config", async () => {
    const captured: Captured = {};
    const out = (await getConfig(fakeFetch(captured, { location_name: "Home" }), CFG)) as {
      location_name: string;
    };
    assert.equal(out.location_name, "Home");
    assert.equal(new URL(captured.url ?? "").pathname, "/api/config");
  });

  it("render_template posts the template and returns plain-text rendered output", async () => {
    const captured: Captured = {};
    const fetchFn: FetchFn = async (url, init) => {
      captured.url = url;
      captured.method = init?.method;
      captured.body = init?.body;
      return textResponse("It is 21 degrees.");
    };
    const out = await renderTemplate(fetchFn, CFG, { template: "It is {{ states('sensor.temp') }} degrees." });
    assert.deepEqual(out, { rendered: "It is 21 degrees." });
    assert.equal(new URL(captured.url ?? "").pathname, "/api/template");
    assert.equal(captured.method, "POST");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), {
      template: "It is {{ states('sensor.temp') }} degrees.",
    });
  });

  it("render_template HTTP error surfaces the status", async () => {
    const failing: FetchFn = async () => textResponse("bad template", 400, "Bad Request");
    await assert.rejects(() => renderTemplate(failing, CFG, { template: "{{" }), /HTTP 400/);
  });

  it("fire_event posts event_data, defaulting to {}", async () => {
    const captured: Captured = {};
    await fireEvent(fakeFetch(captured, { message: "Event fired." }), CFG, { event_type: "my_event" });
    assert.equal(new URL(captured.url ?? "").pathname, "/api/events/my_event");
    assert.equal(captured.method, "POST");
    assert.deepEqual(JSON.parse(captured.body ?? "null"), {});
    const withData: Captured = {};
    await fireEvent(fakeFetch(withData, {}), CFG, {
      event_type: "my_event",
      event_data: { device: "kitchen" },
    });
    assert.deepEqual(JSON.parse(withData.body ?? "{}"), { device: "kitchen" });
  });

  it("fire_event rejects an empty event_type before any request", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => fireEvent(spy, CFG, { event_type: "" }), /event_type must be a non-empty/);
    assert.equal(called, false);
  });
});

describe("errors", () => {
  it("HTTP error surfaces status plus the upstream message", async () => {
    const failing: FetchFn = async () =>
      jsonResponse({ message: "Entity not found." }, 404, "Not Found");
    await assert.rejects(
      () => getEntityState(failing, CFG, { entity_id: "sensor.missing" }),
      /HTTP 404.*Entity not found\./,
    );
  });
});

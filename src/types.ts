/**
 * smarthome-port types.
 *
 * Shapes follow the public Home Assistant REST API: entities are
 * addressed by an entity_id of the form "domain.object_id", services
 * live under a domain, history is a time window over one entity, and
 * templates are rendered server-side. Connection settings are passed
 * in as a small config object so tests never need real environment
 * variables. HTTP access is described by a minimal response surface
 * so tests can inject a fake fetch and never touch the network.
 */

export interface SmarthomeConfig {
  token?: string;
  baseUrl?: string;
}

export interface ListEntitiesOptions {
  domain?: string;
}

export interface GetEntityStateOptions {
  entity_id: string;
}

export interface CallServiceOptions {
  domain: string;
  service: string;
  entity_id?: string;
  service_data?: Record<string, unknown>;
}

export interface ListServicesOptions {
  domain?: string;
}

export interface GetHistoryOptions {
  entity_id: string;
  hours?: number;
}

export interface RenderTemplateOptions {
  template: string;
}

export interface FireEventOptions {
  event_type: string;
  event_data?: Record<string, unknown>;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

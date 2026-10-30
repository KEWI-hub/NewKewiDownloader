/**
 * Short-lived map of recent requests and the headers the browser sent
 * (`webRequest.onSendHeaders` with `extraHeaders` in Chromium so Cookie and
 * Referer are visible). The downloads API exposes no request headers, so
 * capture and media sniffing look requests up here.
 */
import { IS_FIREFOX, api } from '../shared/api';

export interface RequestInfo {
  requestId: string;
  url: string;
  /** First URL of a redirect chain. */
  originalUrl?: string;
  method: string;
  tabId: number;
  frameId: number;
  type: string;
  referer?: string;
  origin?: string;
  cookie?: string;
  ts: number;
}

const TTL_MS = 60_000;
const MAX_BY_URL = 400;

const byId = new Map<string, RequestInfo>();
const byUrl = new Map<string, RequestInfo>();

export const TRACKED_TYPES = ['main_frame', 'sub_frame', 'media', 'xmlhttprequest', 'other', 'object'] as chrome.webRequest.ResourceType[];

function remember(info: RequestInfo): void {
  byUrl.delete(info.url);
  byUrl.set(info.url, info);
  if (byUrl.size > MAX_BY_URL) {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of byUrl) {
      if (byUrl.size <= MAX_BY_URL * 0.75 && v.ts >= cutoff) break;
      byUrl.delete(k);
    }
  }
}

function header(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  const h = headers?.find((x) => x.name.toLowerCase() === name);
  return h?.value;
}

export function initRequestTracking(): void {
  const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'], types: TRACKED_TYPES };
  const spec: string[] = ['requestHeaders'];
  const extra = (api.webRequest as unknown as { OnSendHeadersOptions?: { EXTRA_HEADERS?: string } }).OnSendHeadersOptions?.EXTRA_HEADERS;
  if (!IS_FIREFOX && extra) spec.push(extra);

  api.webRequest.onSendHeaders.addListener(
    (d) => {
      const prev = byId.get(d.requestId);
      const info: RequestInfo = {
        requestId: d.requestId,
        url: d.url,
        method: d.method,
        tabId: d.tabId,
        frameId: d.frameId,
        type: d.type,
        referer: header(d.requestHeaders, 'referer'),
        origin: header(d.requestHeaders, 'origin'),
        cookie: header(d.requestHeaders, 'cookie'),
        ts: Date.now(),
        ...(prev ? { originalUrl: prev.originalUrl ?? prev.url } : {}),
      };
      byId.set(d.requestId, info);
      remember(info);
    },
    filter,
    spec as chrome.webRequest.OnSendHeadersOptions[],
  );

  const done = (d: { requestId: string }) => {
    // Keep it briefly: onDeterminingFilename can fire after onCompleted for tiny files.
    setTimeout(() => byId.delete(d.requestId), 5000);
  };
  api.webRequest.onCompleted.addListener(done, filter);
  api.webRequest.onErrorOccurred.addListener(done, filter);
}

export function requestById(id: string): RequestInfo | undefined {
  return byId.get(id);
}

/** Most recent request for `url` within the TTL. */
export function requestByUrl(url: string | undefined): RequestInfo | undefined {
  if (!url) return undefined;
  const r = byUrl.get(url);
  return r && Date.now() - r.ts <= TTL_MS ? r : undefined;
}

import { api } from '../shared/api';
import type { NativeError } from '../shared/correlator';
import type { ConnectionInfo } from '../shared/messages';
import type { CaptureSettings } from '../shared/protocol';
import { STATE_KEY, type StoredState, defaultState, normalizeSettings, normalizeState } from '../shared/settings';

let cached: StoredState | null = null;
let loading: Promise<StoredState> | null = null;

/** Loads the persisted state (cached in memory for the life of the worker). */
export function getState(): Promise<StoredState> {
  if (cached) return Promise.resolve(cached);
  loading ??= api.storage.local
    .get(STATE_KEY)
    .then((r) => (cached = normalizeState(r[STATE_KEY])))
    .catch(() => (cached = defaultState()))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Synchronous view (may be null right after a worker start). */
export function peekState(): StoredState | null {
  return cached;
}

export async function updateState(patch: Partial<StoredState>): Promise<StoredState> {
  const cur = await getState();
  cached = { ...cur, ...patch };
  await api.storage.local.set({ [STATE_KEY]: cached });
  return cached;
}

/** Settings from the app's hello reply; ignored while the user has local overrides. */
export async function applyAppSettings(partial: Partial<CaptureSettings> | undefined, appVersion?: string, force = false): Promise<void> {
  const cur = await getState();
  const patch: Partial<StoredState> = {};
  if (appVersion) patch.appVersion = appVersion;
  if (partial && (cur.settingsSource === 'app' || force)) {
    patch.settings = normalizeSettings(partial);
    patch.settingsSource = 'app';
  }
  if (Object.keys(patch).length) await updateState(patch);
}

// Keep the cache coherent when Options/another context writes storage.
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATE_KEY]) cached = normalizeState(changes[STATE_KEY].newValue);
});

// ---- connection indicator ---------------------------------------------------

const connection: ConnectionInfo = { state: 'unknown' };
const connectionListeners: Array<(c: ConnectionInfo) => void> = [];

export function getConnection(): ConnectionInfo {
  return { ...connection };
}

export function onConnectionChange(l: (c: ConnectionInfo) => void): void {
  connectionListeners.push(l);
}

export function markConnected(appVersion?: string): void {
  const changed = connection.state !== 'connected';
  connection.state = 'connected';
  if (appVersion) connection.appVersion = appVersion;
  delete connection.error;
  delete connection.errorCode;
  connection.checkedAt = Date.now();
  if (changed) connectionListeners.forEach((l) => l(getConnection()));
}

/** Records a failed exchange. Only transport/app-availability errors change the state. */
export function markFailure(err: NativeError): void {
  let state: ConnectionInfo['state'];
  switch (err.code) {
    case 'host_missing':
    case 'host_forbidden':
      state = 'host_missing';
      break;
    case 'app_not_running':
    case 'app_unreachable':
    case 'timeout':
    case 'host_exited':
    case 'disconnected':
    case 'unauthorized':
      state = 'app_down';
      break;
    default:
      return; // an app-level error means the app is reachable
  }
  const changed = connection.state !== state;
  connection.state = state;
  connection.error = err.message;
  connection.errorCode = err.code;
  connection.checkedAt = Date.now();
  if (changed) connectionListeners.forEach((l) => l(getConnection()));
}

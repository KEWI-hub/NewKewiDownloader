/**
 * Bypass modifier tracking: a link clicked while the bypass key is held is
 * reported to the background (URL + timestamp) *before* the click navigates,
 * so the capture code lets the browser keep that download.
 */
import { sendInternal } from '../shared/api';
import type { BypassKey } from '../shared/protocol';

let key: BypassKey = 'alt';
let lastSent = '';
let lastSentAt = 0;

export function setBypassKey(k: BypassKey): void {
  key = k;
}

function held(e: MouseEvent): boolean {
  switch (key) {
    case 'alt':
      return e.altKey;
    case 'shift':
      return e.shiftKey;
    case 'ctrl':
      return e.ctrlKey;
    case 'meta':
      return e.metaKey;
    default:
      return false;
  }
}

function linkFrom(e: Event): string | undefined {
  for (const n of e.composedPath()) {
    if (n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) {
      if (n.href) return n.href;
    }
  }
  return undefined;
}

function onPointer(e: MouseEvent): void {
  if (key === 'none' || !held(e)) return;
  const url = linkFrom(e);
  const now = Date.now();
  const sig = url ?? '';
  // mousedown + click for the same link → one message.
  if (sig === lastSent && now - lastSentAt < 1000) return;
  lastSent = sig;
  lastSentAt = now;
  void sendInternal({ kind: 'bypass', ...(url ? { url } : {}), ts: now });
}

export function initBypass(): void {
  window.addEventListener('mousedown', onPointer, { capture: true, passive: true });
  window.addEventListener('click', onPointer, { capture: true, passive: true });
  window.addEventListener('auxclick', onPointer, { capture: true, passive: true });
}

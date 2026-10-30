/** Error from the native host / app (`code` mirrors the protocol error codes). */
export class NativeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NativeError';
  }
}

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Request/response correlation by `id` with per-request timeouts.
 * Ids are `<random prefix>-<counter>` so replies from a previous port/SW
 * instance can never resolve a new request.
 */
export class Correlator<T extends { id?: unknown }> {
  private pending = new Map<string, Pending<T>>();
  private counter = 0;
  private readonly prefix: string;

  constructor(
    private readonly defaultTimeoutMs = 3000,
    prefix?: string,
  ) {
    this.prefix = prefix ?? Math.random().toString(36).slice(2, 8);
  }

  nextId(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }

  get size(): number {
    return this.pending.size;
  }

  /** Waits for the reply with `id`; rejects with `NativeError('timeout')` after the timeout. */
  wait(id: string, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NativeError('timeout', `no reply within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Routes a reply to its waiter. Returns false for unknown/late ids. */
  resolve(reply: T): boolean {
    const id = reply?.id;
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    const p = this.pending.get(String(id));
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(String(id));
    p.resolve(reply);
    return true;
  }

  /** Rejects one waiter (e.g. its postMessage failed). */
  reject(id: string, err: Error): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(err);
  }

  /** Rejects every waiter (port disconnected). */
  rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err);
    }
  }

  ids(): string[] {
    return [...this.pending.keys()];
  }
}

/** Maps a port disconnect message to a protocol-style error code. */
export function classifyDisconnect(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('not found') || m.includes('no such native application') || m.includes('not exist')) return 'host_missing';
  if (m.includes('forbidden') || m.includes('access') || m.includes('not allowed')) return 'host_forbidden';
  if (m.includes('exited') || m.includes('error when communicating')) return 'host_exited';
  return 'disconnected';
}

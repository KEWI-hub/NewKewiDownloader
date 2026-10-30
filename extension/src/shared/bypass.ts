/**
 * Remembers recent "let the browser handle it" clicks (link clicked while the
 * bypass modifier was held). Entries with a URL match that download for a
 * while (redirect chains, slow servers); entries without a URL (modifier held
 * but no link found) only cover a short window.
 */
export class BypassTracker {
  private entries: Array<{ url?: string; ts: number }> = [];

  constructor(
    private readonly urlTtlMs = 15_000,
    private readonly anyTtlMs = 2_500,
    private readonly now: () => number = Date.now,
  ) {}

  record(url?: string, ts = this.now()): void {
    this.prune();
    this.entries.push(url ? { url: normalize(url), ts } : { ts });
    if (this.entries.length > 50) this.entries.shift();
  }

  /** True when a recent bypass click applies to a download with these URLs. Does not consume. */
  isActive(urls: Array<string | undefined>): boolean {
    this.prune();
    const t = this.now();
    const wanted = urls.filter((u): u is string => !!u).map(normalize);
    return this.entries.some((e) => (e.url ? wanted.includes(e.url) : t - e.ts <= this.anyTtlMs));
  }

  private prune(): void {
    const t = this.now();
    this.entries = this.entries.filter((e) => t - e.ts <= (e.url ? this.urlTtlMs : this.anyTtlMs));
  }
}

function normalize(u: string): string {
  const i = u.indexOf('#');
  return i >= 0 ? u.slice(0, i) : u;
}

/** `a` is a later version than `b` ("1.10.0" > "1.9.2"); a missing part counts as 0, anything
 *  after a "-" (a pre-release label) is ignored. */
export function versionNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

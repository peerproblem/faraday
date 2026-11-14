/** Sliding-window rate limiter kept in memory. One instance per rule. */
export function createLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();
  let sweptAt = 0;

  function sweep(now: number) {
    if (now - sweptAt < opts.windowMs) return;
    sweptAt = now;
    for (const [k, ts] of hits) {
      const kept = ts.filter((t) => now - t < opts.windowMs);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }

  return {
    /** Records a hit when allowed. retryAfterMs is how long until the oldest hit leaves the window. */
    hit(key: string, now = Date.now()): { ok: boolean; retryAfterMs: number } {
      sweep(now);
      const ts = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (ts.length >= opts.max) {
        hits.set(key, ts);
        return { ok: false, retryAfterMs: opts.windowMs - (now - ts[0]) };
      }
      ts.push(now);
      hits.set(key, ts);
      return { ok: true, retryAfterMs: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;

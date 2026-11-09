import "server-only";

/**
 * @file rate-limiter.ts
 * @description Sliding-window rate limiter for authentication endpoints.
 *
 * @usedBy
 * `login.service.ts` (per phone and per IP), `forgot-password.service.ts`.
 *
 * @remarks
 * State lives in this process's memory: limits are per server instance and reset when the
 * process restarts. Entries are never evicted, only pruned when the same key is checked again.
 */

interface RateLimitEntry {
  timestamps: number[];
}

class InMemoryRateLimiter {
  private store = new Map<string, RateLimitEntry>();

  /**
   * Checks if an action is within rate limits.
   * If within limit, records the current timestamp and returns true.
   * If limit exceeded, returns false.
   */
  check(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.store.get(key) ?? { timestamps: [] };

    // Prune expired timestamps
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      return false;
    }

    entry.timestamps.push(now);
    this.store.set(key, entry);
    return true;
  }

  /**
   * Clears all stored rate limits (useful in tests).
   */
  clear(): void {
    this.store.clear();
  }
}

export const authRateLimiter = new InMemoryRateLimiter();

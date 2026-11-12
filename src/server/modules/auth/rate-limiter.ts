import "server-only";

/**
 * @file rate-limiter.ts
 * @description Sliding-window rate limiter for authentication endpoints.
 *
 * @usedBy
 * `login.service.ts` (failed attempts per phone and per IP: `reserveAttempt`),
 * `forgot-password.service.ts` (requests per email and per IP: `check`).
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
   * Failure-only lockout (login, QA-24). In ONE synchronous step — so concurrent requests
   * cannot all slip under the limit — it checks `key` and, when not locked, reserves a slot
   * for this attempt. The caller then:
   * - on a failed attempt keeps the slot (it counts as a failure);
   * - on a successful attempt calls `release()` (a success never counts).
   * Locked: `retryAfterMs` is when the oldest counted attempt leaves the window.
   */
  reserveAttempt(
    key: string,
    maxFailures: number,
    windowMs: number,
  ):
    | { locked: false; release: () => void }
    | { locked: true; retryAfterMs: number } {
    const now = Date.now();
    const entry = this.store.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
    if (entry.timestamps.length >= maxFailures) {
      const oldest =
        entry.timestamps[entry.timestamps.length - maxFailures] ?? now;
      this.store.set(key, entry);
      return {
        locked: true,
        retryAfterMs: Math.max(1, oldest + windowMs - now),
      };
    }
    entry.timestamps.push(now);
    this.store.set(key, entry);
    let released = false;
    return {
      locked: false,
      release: () => {
        if (released) return;
        released = true;
        const current = this.store.get(key);
        if (!current) return;
        const at = current.timestamps.indexOf(now);
        if (at >= 0) current.timestamps.splice(at, 1);
      },
    };
  }

  /** Forgets every counted attempt of `key` (a successful login clears its phone). */
  reset(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clears all stored rate limits (useful in tests).
   */
  clear(): void {
    this.store.clear();
  }
}

export const authRateLimiter = new InMemoryRateLimiter();

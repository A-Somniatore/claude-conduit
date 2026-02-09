/**
 * Per-session mutex using promise chaining.
 * Each acquire() appends to the chain — no gap between releases.
 */
export class SessionLock {
  private chains = new Map<string, Promise<void>>();

  async acquire<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();

    let resolve: () => void;
    const next = new Promise<void>((r) => {
      resolve = r;
    });

    // Chain: our work starts after prev finishes
    const work = prev.then(async () => {
      try {
        return await fn();
      } finally {
        resolve!();
      }
    });

    // Register our completion promise as the tail of the chain
    // Use .catch(() => {}) so a rejected promise doesn't block the next waiter
    const wrapped = next.catch(() => {});
    this.chains.set(sessionId, wrapped);

    try {
      return await work;
    } finally {
      // Clean up if we're the last in the chain
      if (this.chains.get(sessionId) === wrapped) {
        this.chains.delete(sessionId);
      }
    }
  }

  isLocked(sessionId: string): boolean {
    return this.chains.has(sessionId);
  }
}

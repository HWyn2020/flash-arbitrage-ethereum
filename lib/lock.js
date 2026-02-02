import Redis from 'ioredis';

// Redis-backed lock helper with a resilient fallback when Redis is unavailable.
// In environments without Redis (local dev), this will use a simple in-memory no-op lock.
class InMemoryLock {
  constructor() {
    this.store = new Map();
  }

  async acquire(key, ttl = 10000) {
    if (this.store.has(key)) return null;
    const token = Math.random().toString(36).slice(2);
    this.store.set(key, token);
    // schedule expiry
    setTimeout(() => { if (this.store.get(key) === token) this.store.delete(key); }, ttl);
    return token;
  }

  async release(key, token) {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }

  async quit() {
    this.store.clear();
  }
}

export class RedisLock {
  constructor(redisUrl) {
    this._useInMemory = false;
    try {
      this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379');
      // Attach a simple error handler to avoid unhandled errors bubbling up
      this.redis.on('error', (err) => {
        // If connection refused or other connection errors occur, fall back to in-memory lock
        if (!this._useInMemory) {
          // switch to in-memory fallback
          this._useInMemory = true;
          this._inMemory = new InMemoryLock();
        }
      });
    } catch (e) {
      this._useInMemory = true;
      this._inMemory = new InMemoryLock();
    }
  }

  // Acquire a lock, returns token string if acquired, null otherwise.
  async acquire(key, ttl = 10000) {
    if (this._useInMemory) {
      return await this._inMemory.acquire(key, ttl);
    }
    try {
      const token = Math.random().toString(36).slice(2);
      const ok = await this.redis.set(key, token, 'PX', ttl, 'NX');
      return ok ? token : null;
    } catch (e) {
      // On any Redis error, fallback to in-memory locking for robustness
      this._useInMemory = true;
      this._inMemory = new InMemoryLock();
      return await this._inMemory.acquire(key, ttl);
    }
  }

  // Release lock only if token matches
  async release(key, token) {
    if (this._useInMemory) {
      return await this._inMemory.release(key, token);
    }
    const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    try {
      return await this.redis.eval(script, 1, key, token);
    } catch (e) {
      // fallback
      this._useInMemory = true;
      this._inMemory = new InMemoryLock();
      return await this._inMemory.release(key, token);
    }
  }

  async quit() {
    if (this._useInMemory) return;
    try {
      await this.redis.quit();
    } catch (e) {
      // ignore
    }
  }
}

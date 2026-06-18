# Connection Pooling & Caching — Recommendations (P-05/P-06)

**Status:** Recommended for production scale. Not currently deployed.  
**Last updated:** 2026-06-18

---

## P-05: PgBouncer (connection pooling)

### Problem

Next.js Server Functions run on ephemeral serverless workers. Each worker opens its own PostgreSQL connection. With Neon or any standard PostgreSQL host, the default max connections (typically 100) can be exhausted under burst load.

### Recommendation

Add PgBouncer in **transaction mode** between the app and PostgreSQL:

```
Next.js workers ──▶ PgBouncer (transaction mode) ──▶ PostgreSQL
```

**Configuration baseline (`pgbouncer.ini`):**

```ini
[databases]
bodega = host=<pg-host> port=5432 dbname=bodega

[pgbouncer]
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
min_pool_size = 5
listen_port = 6432
```

**Drizzle / DATABASE_URL:**

```
DATABASE_URL=postgres://user:pass@pgbouncer-host:6432/bodega
```

**Caveats with Drizzle + PgBouncer transaction mode:**
- `SET` commands and advisory locks (used by the registration advisory lock) do not survive across statements in transaction mode. The advisory lock in `registro/actions.ts` uses `pg_advisory_xact_lock` (transaction-scoped), which is safe.
- `LISTEN/NOTIFY` is not supported in transaction mode — not used in this app.

### Neon alternative

If using Neon, the Neon serverless driver (`@neondatabase/serverless`) already implements HTTP-based connection pooling. Use the Neon HTTP adapter for Drizzle:

```typescript
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })
```

---

## P-06: Redis (rate-limit + badge cache)

### Problem

The current rate-limit implementation (`lib/services/rate-limit.ts`) stores attempt counts in PostgreSQL (`rate_limits` table). Under high concurrency, these writes add latency to every login attempt and API request. The badge count cache in `app/(app)/layout.tsx` uses Next.js `unstable_cache` (in-process), which is not shared across multiple app replicas.

### Recommendation

**Phase 1 — badge cache (quick win):**  
If deploying multiple replicas, replace `unstable_cache` with a Redis-backed cache. The cache key pattern is already isolated (`badge-counts`, `dashboard`) so switching to Redis requires only changing the cache backend:

```typescript
// lib/cache.ts (proposed)
import { Redis } from "@upstash/redis"
const redis = new Redis({ url: process.env.UPSTASH_REDIS_URL!, token: process.env.UPSTASH_REDIS_TOKEN! })

export async function getCached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const cached = await redis.get<T>(key)
  if (cached !== null) return cached
  const value = await fn()
  await redis.set(key, value, { ex: ttl })
  return value
}
```

**Phase 2 — rate-limit backend (correctness improvement):**  
Replace PostgreSQL-backed rate limits with Redis atomic operations:

```typescript
// Pseudocode
const key = `rate:${identifier}`
const count = await redis.incr(key)
if (count === 1) await redis.expire(key, WINDOW_SECONDS)
return count <= MAX_ATTEMPTS
```

Redis INCR is atomic and avoids the upsert race condition in the current PostgreSQL implementation.

### Recommended provider

**Upstash Redis** — serverless-friendly, pay-per-request, works with Vercel/Neon deployments. Free tier covers ~50 users easily.

```
npm install @upstash/redis
```

```
UPSTASH_REDIS_URL=https://...
UPSTASH_REDIS_TOKEN=...
```

---

## Decision matrix

| Setup | Scale | Cost | Complexity |
|---|---|---|---|
| Current (PostgreSQL only) | ≤ 50 users, single replica | Zero extra | Zero |
| Neon serverless driver | ≤ 500 req/s, Neon PG | Neon plan | Low |
| PgBouncer + PostgreSQL | Unlimited replicas | VPS cost | Medium |
| Upstash Redis (Phase 1) | Multi-replica, shared cache | ~$0/month for 50 users | Low |
| Upstash Redis (Phase 2) | High-concurrency login | ~$0/month for 50 users | Medium |

**Current posture:** PostgreSQL-only is adequate for ≤ 50 internal users on a single-replica deployment. Revisit when replica count > 1 or peak concurrent users > 20.

# ADR 0004 — Service Layer Architecture: Module-Level Imports vs. Dependency Injection

**Date:** 2026-06-18  
**Status:** Accepted (defer injection, keep current pattern)  
**Addresses:** R-04 (inject `db`/`session` into services), R-05 (resolve `modules/` freeze)

---

## Context

### R-04: Dependency injection in services

Current pattern: service functions import `db` and `auth` directly at module level.

```typescript
// lib/services/purchasing.ts
import { db } from "@/db"
import { auth } from "@/lib/auth/auth"

export async function createOrder(input: CreateOrderInput) {
  const session = await auth()
  // ...
  await db.insert(purchaseOrders).values(...)
}
```

Proposed alternative (factory injection):

```typescript
export function createServices({ db, session }: { db: DB, session: Session }) {
  return {
    createOrder: async (input: CreateOrderInput) => { ... }
  }
}
```

**Benefit of injection:** True unit tests without module-level mock gymnastics (`vi.mock("@/db")`, etc.).  
**Cost of injection:** ~5 days to refactor all ~40 service functions; every call site must construct the services object; Next.js Server Actions would need a `getServices()` factory at the top of every action file.

**Current state:** The test suite uses a real PostgreSQL database (integration tests). `vi.mock` is used only for SMTP and a few external services. The actual `db` mock burden is low.

### R-05: `modules/` freeze

The codebase has a partially-migrated `modules/` directory from an abandoned "monolito modular" migration (Fase 0/1, pruned 2026-06-14). The active business logic lives entirely in `lib/` + `app/`. `modules/` now only holds:
- `modules/registry.ts` — nav/route registry
- `modules/permissions.ts` — permission constants
- `modules/manifest-types.ts` — TypeScript manifest types
- `modules/*/manifest.ts` — per-module nav/permission declarations

---

## Decision

### R-04: Defer injection

**Do not refactor to dependency injection at this time.**

Reasons:
1. The test suite already achieves meaningful coverage via integration tests against a real DB. The marginal benefit of pure unit tests does not justify the 5-day refactor cost.
2. Next.js Server Actions and the App Router make injecting `session` awkward — `auth()` must be called at the top of every request anyway to enforce authentication.
3. The current pattern is idiomatic for Next.js App Router + Drizzle. Most production Next.js codebases follow the same module-import pattern.

**Re-evaluate if:** the test suite grows to the point where integration tests against a real DB become too slow (> 2 minutes), or a new team member struggles to mock DB calls for isolated unit tests.

### R-05: Keep `modules/` frozen, clean up if explicitly scheduled

**Keep `modules/` frozen per AGENTS.md.**

- The four live files (`registry.ts`, `permissions.ts`, `manifest-types.ts`, per-module `manifest.ts`) are the only surface that remains. They provide navigation and permission constants used across the app.
- **Do not** recreate `modules/*/{services,actions,schema,validation}` or `core/*`.
- **Do not** move `registry.ts`/`permissions.ts` into `lib/` unless a full reconciliation sprint (estimated 10 days, high risk) is explicitly scoped with parity tests.
- The freeze decision is documented in `modules/README.md` and `AGENTS.md`.

The "complete the migration vs. remove `modules/`" decision is deferred to a dedicated sprint with a reconciliation plan and parity tests.

---

## Consequences

- No architectural churn in the short term; developers follow the existing pattern.
- `modules/registry.ts` and `modules/permissions.ts` remain the single source of truth for nav and permissions.
- Any new business logic goes in `lib/services/` or `app/(app)/<feature>/actions.ts` — never in `modules/`.
- This ADR supersedes the informal guidance in the sprint notes and formalizes the decision as recorded.

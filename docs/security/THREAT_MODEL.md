# Threat Model — Plataforma Chome

**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Last updated:** 2026-06-20  
**Scope:** Web application + PostgreSQL database + SMTP relay. Internal tool (~50 users, private network).

---

## System context

```
Browser ──HTTPS──▶ Reverse Proxy (NGINX/Traefik/Cloudflare)
                        │
                        ▼
                   Next.js App (Docker standalone)
                        │
                        ├──▶ PostgreSQL (≥ 15)
                        └──▶ SMTP relay (Nodemailer)
```

Trust boundaries: public internet → reverse proxy → app server → database.

---

## Assets

| Asset | Sensitivity |
|---|---|
| User credentials (hashed passwords) | High |
| Session JWTs (`AUTH_SECRET`-signed) | High |
| Purchase orders and amounts | Medium |
| Supplier PII (name, RUT, contact) | Medium |
| Worker PII (name, RUT) | Medium |
| SST inspection records | Medium |
| Audit log entries | Medium |
| Attachment files (receipts, PDF, images) | Low–Medium |

---

## Architecture notes

- **Output mode:** `standalone` (Next.js generates a self-contained `server.js`)
- **Container:** Multi-stage Dockerfile (`node:20-alpine`), runs as non-root `nextjs` user
- **Healthcheck:** `wget` against `/api/health` every 30s; unhealthy containers don't receive traffic
- **CI/CD:** `deploy.yml` builds Docker → GHCR, then runs `drizzle-kit migrate` before rollout
- **CI checks:** typecheck, lint, unit tests with coverage, concurrency tests (real Postgres), Playwright E2E, Docker smoke test

---

## STRIDE analysis

### S — Spoofing

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| S1: Credential stuffing | `/login` | IP + email rate-limit (5 attempts / 15 min), atomic `INSERT...ON CONFLICT DO UPDATE` in PostgreSQL | Low |
| S2: Session token theft | JWT cookie | `httpOnly; Secure; SameSite=Lax`; signed with `AUTH_SECRET` | Low |
| S3: Account takeover via password reset | `/recuperar` | SHA-256 token hash stored, 1-hour TTL, single-use, old tokens invalidated on re-request | Low |
| S4: Invitation replay | `/registro` | Invitation tokens hashed + single-use + email-locked | Low |
| S5: JWT forgery | NextAuth JWT | Signed with `AUTH_SECRET` (≥ 32 bytes required); `getUserRbacById(id, bypassCache=true)` re-validates permissions on every request | Low |

**Recommended:** Rotate `AUTH_SECRET` if any production incident occurs.

---

### T — Tampering

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| T1: SQL injection | All DB queries | Drizzle ORM with parameterized queries; no raw SQL interpolation in application code | Low |
| T2: CSRF on state-mutation forms | Server Actions | Next.js enforces `Origin` header check on Server Action POSTs; all mutations are Server Actions (see CSRF.md for full map) | Low |
| T3: Tamper with purchase request items in-flight | `solicitudes/actions.ts` | Items locked once in `in_purchase_order` state; item state machine rejects invalid transitions | Low |
| T4: Price tampering on OC via direct API call | `/api/*` routes | All mutating routes require authenticated session + permission check via `can()`; all `/api/*` routes are **read-only** (no mutation endpoints) | Low |
| T5: Attachment substitution | `/api/attachments`, `/api/purchase-orders/invoices`, `/api/repuestos/quotaciones`, `/api/servicios/cotizaciones` | Each route resolves the parent entity's worksite and validates via `canAccessWorksite(session, worksiteId)` — users see only attachments belonging to their assigned worksites | Low |
| T6: File upload spoofing | All upload handlers | Magic bytes validated server-side via `validateFileBuffer()` (lib/file-validation.ts); MIME normalized independently of client-declared Content-Type; accepts PDF, JPEG, PNG, XML | Low |

---

### R — Repudiation

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| R1: Deny creating a purchase request | `audit_log` table | Every state transition writes an `audit_log` entry with `userId`, `action`, `entityId`, timestamp, old/new state | Low |
| R2: Deny approving/rejecting items | `approval_decisions` table | Approval decisions recorded with `decidedBy` + timestamp + roleContext | Low |
| R3: Log injection | Logger | Structured JSON logger (`pino`); no user-controlled log keys; redacts `password`, `token`, `secret`, `hash` keys | Low |

**Recommended:** Ensure `audit_log` entries are immutable (no UPDATE/DELETE permissions for app role).

---

### I — Information Disclosure

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| I1: User enumeration via login timing | `/login` | Dummy hash always compared; ~constant time response | Low |
| I2: User enumeration via password reset | `/recuperar` | Always returns success message regardless of email existence | Low |
| I3: Sensitive data in logs | Logger | `lib/logger.ts` redacts `password`, `token`, `secret`, `hash` keys | Low |
| I4: Over-sharing in API responses | `/api/*` | Scope guard: non-global users see only their worksite data via `visibleWorksiteIds(session)` | Low |
| I5: Attachment served to wrong user | `/api/attachments/[id]`, `/api/purchase-orders/invoices/[id]`, `/api/repuestos/quotaciones/[id]`, `/api/servicios/cotizaciones/[id]` | Worksite scope check: each route resolves the parent entity's worksite via `canAccessWorksite(session, worksiteId)` — users see only attachments belonging to their assigned worksites | Low |
| I6: Error details leaked to client | Server Actions | Errors return generic `ActionState.message` strings; original errors logged server-side only | Low |
| I7: SMTP credentials in environment | `.env` | Standard practice; `AUTH_SECRET` and `SMTP_PASS` never logged; `.env.example` contains no real values | Low |

---

### D — Denial of Service

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| D1: Brute-force login | `/login` | IP + email rate-limit; atomic in PostgreSQL (survives restarts); stale count reset after lock expiry | Low |
| D2: Unlimited export size | `/api/trazabilidad/export` | `MAX_EXPORT_ROWS = 10_000`; `requestLimit = 5_000` at DB query level | Low |
| D3: Notification flood via repeated actions | `lib/services/notifications.ts` | Notification creation is server-side, not user-triggered directly; `notifySafe()` helper catches errors | Low |
| D4: Large attachment upload | Upload handlers | `PDF_MAX_SIZE_MB` system setting (default 10 MB); enforced before writing to disk | Low |
| D5: Container crash from bad DB | Docker | `HEALTHCHECK` in Dockerfile; `connect_timeout=10s` in DB pool; fail-fast on startup if `DATABASE_URL` missing | Low |

---

### E — Elevation of Privilege

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| E1: Normal user accessing admin routes | `/admin/*` | `requirePermission("admin:*")` in every admin page/action | Low |
| E2: Cross-worksite data access | All scoped queries | `visibleWorksiteIds(session)` enforced in every list/detail query | Low |
| E3: Inactive user retains session | JWT callback | `getUserRbacById(id, bypassCache=true)` re-fetches on every request; `isActive=false` → null token | Low |
| E4: Role escalation via invitation | `/registro` | Invited roles are set by admin at invitation creation; user cannot choose roles | Low |
| E5: Server Action called without session | All Server Actions | `auth()` called at top of every action; returns `{ ok: false }` or throws if unauthenticated | Low |
| E6: Request-type permission bypass | `lib/request-types.ts` | `permissionForRequestType()` validates module-specific permission (e.g. `repuestos:create`); UI filters options by effective permissions | Low |
| E7: Quotation deletion by non-owner | `lib/requests/quotation-access.ts` | `assertCanDeleteQuotation()` validates `requestId`, faena visibility, and ownership/elevated permission | Low |

---

## File upload security

All file uploads (cotizaciones, facturas, comprobantes, actas SST) flow through
Server Actions, inheriting CSRF protection. Additional controls:

| Control | Implementation |
|---|---|
| Magic bytes validation | `lib/file-validation.ts` — `validateFileBuffer()` checks PDF (`%PDF`), JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), XML (`<?xml`) signatures |
| MIME normalization | Returns authoritative MIME type regardless of client-declared Content-Type |
| BOM stripping | UTF-8 BOM (`EF BB BF`) stripped before XML detection |
| Size limit | `PDF_MAX_SIZE_MB` system setting, enforced before buffer read |
| Allowed types per context | `MimeType.QUOTATION` (PDF, JPEG, PNG), `MimeType.PROOF` (PDF, JPEG, PNG), `MimeType.INVOICE` (PDF, JPEG, PNG, XML) |

---

## Out of scope

- Infrastructure-level attacks (network sniffing, host compromise) — handled by Vercel/VPS hardening
- Physical access to database server
- Supply-chain attacks on npm dependencies (mitigated by `npm audit` in CI)
- Client-side XSS (Next.js auto-escapes by default; no `dangerouslySetInnerHTML` without sanitization)

---

## Accepted risks

| Risk | Justification |
|---|---|
| JWT not revocable mid-session (except via `isActive` check) | Acceptable for short-lived sessions + `isActive` guard; full revocation would require Redis |
| No 2FA | Internal tool, 50 users; admin can enforce strong passwords |
| SMTP credentials in env | Standard practice; rotated on any suspected exposure |
| `QuotationTable` uses `as unknown as` cast in `request-service.ts` | Drizzle's deeply generic table types are impractical to spell in a factory pattern; real shape enforced by concrete table instances (`repuestoQuotations`, `serviceQuotations`) |
| Rate limit depends on proxy setting `X-Forwarded-For` correctly | Documented in DEPLOY.md; email-based rate limit provides fallback per-account protection |

---

## Security controls summary

| Category | Control | Location |
|---|---|---|
| Authentication | NextAuth v5 Credentials + JWT | `lib/auth/auth.ts` |
| Authorization | RBAC with per-request-type permissions | `lib/auth/can.ts`, `lib/request-types.ts` |
| Attachment access | Worksite scope via `canAccessWorksite()` on each route | `app/api/attachments/[id]`, `app/api/*/route.ts` |
| CSRF | Server Actions only (no mutating API routes) | `docs/security/CSRF.md` |
| Rate limiting | Atomic INSERT...ON CONFLICT DO UPDATE | `lib/services/rate-limit.ts` |
| File validation | Magic bytes + MIME normalization | `lib/file-validation.ts` |
| Input validation | Zod schemas on all Server Actions | `lib/validation/*.ts` |
| SQL injection | Drizzle ORM (parameterized queries) | `db/index.ts` |
| Audit trail | Immutable audit_log entries | `lib/audit.ts` |
| Security headers | HSTS, X-Frame-Options, nosniff, CSP | `next.config.ts` |
| Container security | Non-root user, HEALTHCHECK, standalone | `Dockerfile` |
| CI/CD | Typecheck, lint, tests, Docker smoke, Playwright E2E | `.github/workflows/ci.yml` |

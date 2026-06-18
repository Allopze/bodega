# Threat Model — Chome Solicitudes y Bodega

**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Last updated:** 2026-06-18  
**Scope:** Web application + PostgreSQL database + SMTP relay. Internal tool (~50 users, private network).

---

## System context

```
Browser ──HTTPS──▶ Next.js App (Vercel / Docker)
                        │
                        ├──▶ PostgreSQL (Neon / self-hosted)
                        └──▶ SMTP relay (Nodemailer)
```

Trust boundaries: public internet → reverse proxy → app server → database.

---

## Assets

| Asset | Sensitivity |
|---|---|
| User credentials (hashed passwords) | High |
| Session JWTs | High |
| Purchase orders and amounts | Medium |
| Supplier PII (name, RUT, contact) | Medium |
| Worker PII (name, RUT) | Medium |
| SST inspection records | Medium |
| Audit log entries | Medium |
| Attachment files (receipts, PDF) | Low–Medium |

---

## STRIDE analysis

### S — Spoofing

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| S1: Credential stuffing | `/login` | IP + email rate-limit (5 attempts / 15 min), custom error codes surfaced to UI (U-02) | Low |
| S2: Session token theft | JWT cookie | `httpOnly; Secure; SameSite=Lax`; short-lived (JWT default) | Low |
| S3: Account takeover via password reset | `/recuperar` | SHA-256 token hash stored, 1-hour TTL, single-use, old tokens invalidated on re-request (U-03) | Low |
| S4: Invitation replay | `/registro` | Invitation tokens hashed + single-use + email-locked | Low |
| S5: JWT forgery | NextAuth JWT | Signed with `AUTH_SECRET` (≥ 32 bytes required) | Low |

**Recommended:** Rotate `AUTH_SECRET` if any production incident occurs.

---

### T — Tampering

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| T1: SQL injection | All DB queries | Drizzle ORM with parameterized queries; no raw SQL interpolation | Low |
| T2: CSRF on state-mutation forms | Server Actions | Next.js enforces `Origin` header check on Server Action POSTs; CSRF.md documents the control | Low |
| T3: Tamper with purchase request items in-flight | `solicitudes/actions.ts` | Items locked once in `in_purchase_order` state; item state machine rejects invalid transitions | Low |
| T4: Price tampering on OC via direct API call | `/api/*` routes | All mutating routes require authenticated session + permission check via `can()` | Low |
| T5: Attachment substitution | `/api/attachments` | Attachment ownership validated against `userId` in session before serving | Low |

---

### R — Repudiation

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| R1: Deny creating a purchase request | `audit_log` table | Every state transition writes an `audit_log` entry with `userId`, `action`, `entityId`, timestamp | Low |
| R2: Deny approving/rejecting items | `approval_decisions` table | Approval decisions recorded with `decidedBy` + timestamp | Low |
| R3: Log injection | Logger | Structured JSON logger; no user-controlled log keys; pino redacts sensitive fields | Low |

**Recommended:** Ensure `audit_log` entries are immutable (no UPDATE/DELETE permissions for app role).

---

### I — Information Disclosure

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| I1: User enumeration via login timing | `/login` | Dummy hash always compared; ~constant time response | Low |
| I2: User enumeration via password reset | `/recuperar` | Always returns success message regardless of email existence | Low |
| I3: Sensitive data in logs | Logger | `lib/logger.ts` redacts `password`, `token`, `secret`, `hash` keys | Low |
| I4: Over-sharing in API responses | `/api/*` | Scope guard: non-global users see only their worksite data | Low |
| I5: Attachment served to wrong user | `/api/attachments/[id]` | Ownership check: `attachment.userId === session.user.id` | Low |
| I6: Error details leaked to client | Server Actions | Errors return generic `ActionState.message` strings; original errors logged server-side only | Low |

**Recommended:** Add `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers (review CSP.md).

---

### D — Denial of Service

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| D1: Brute-force login | `/login` | IP + email rate-limit; persistent in PostgreSQL (survives restarts) | Low |
| D2: Unlimited export size | `/api/trazabilidad/export` | `MAX_EXPORT_ROWS = 10_000`; `requestLimit = 5_000` at DB query level (A-07) | Low |
| D3: Notification flood via repeated actions | `lib/services/notifications.ts` | Notification creation is server-side, not user-triggered directly | Low |
| D4: Large attachment upload | `/api/attachments` | `PDF_MAX_SIZE_MB` system setting (default 10 MB); enforced before writing to disk | Low |

**Gap (P-05/P-06):** No PgBouncer or connection pooling is configured. A burst of concurrent requests could exhaust the database connection pool. See `docs/deploy/PGBOUNCER.md` for recommendations.

---

### E — Elevation of Privilege

| Threat | Affected component | Existing control | Residual risk |
|---|---|---|---|
| E1: Normal user accessing admin routes | `/admin/*` | `requirePermission("admin:*")` in every admin page/action | Low |
| E2: Cross-worksite data access | All scoped queries | `visibleWorksiteIds(session)` enforced in every list/detail query | Low |
| E3: Inactive user retains session | JWT callback | `getUserRbacById(id, bypassCache=true)` re-fetches on every request; `isActive=false` → null token | Low |
| E4: Role escalation via invitation | `/registro` | Invited roles are set by admin at invitation creation; user cannot choose roles | Low |
| E5: Server Action called without session | All Server Actions | `auth()` called at top of every action; returns `{ ok: false }` or throws if unauthenticated | Low |

---

## Out of scope

- Infrastructure-level attacks (network sniffing, host compromise) — handled by Vercel/VPS hardening
- Physical access to database server
- Supply-chain attacks on npm dependencies (mitigated by `npm audit` in CI)

---

## Accepted risks

| Risk | Justification |
|---|---|
| JWT not revocable mid-session (except via `isActive` check) | Acceptable for 15-min session + `isActive` guard; full revocation would require Redis |
| No 2FA | Internal tool, 50 users; admin can enforce strong passwords |
| SMTP credentials in env | Standard practice; rotated on any suspected exposure |

# ADR 0003 — Audit Log and Inventory Movements Retention Policy

**Date:** 2026-06-18  
**Status:** Accepted  
**Addresses:** DB-02 (inventory_movements growth), DB-03 (audit_log growth + legal retention)

---

## Context

Two append-only tables grow without bounds:

- `audit_log` — one row per user action. At 200 actions/day × 365 = ~73 000 rows/year.
- `inventory_movements` — one row per stock movement. At 50 movements/day × 365 = ~18 000 rows/year.

### Legal constraint (DB-03)

Chilean law requires occupational safety records to be retained for at least **5 years**:
- DS N°44/2024 (Ministerio del Trabajo, Prevención de Riesgos)
- Ley 16.744 (Accidentes del trabajo y enfermedades profesionales)

`audit_log` records every user action and is the primary evidence trail for compliance audits. Deleting entries before the 5-year minimum is a legal violation.

---

## Decision

### audit_log (DB-03)

**Retain indefinitely up to a 6-year sliding window.**  
After 6 years, delete rows via the `cleanup_old_audit_log(keepYears int DEFAULT 6)` PostgreSQL function (migration `0018`).

- The 6-year default adds a 1-year buffer above the legal minimum.
- The function hard-rejects `keepYears < 5` at the DB level.
- Cleanup is a **manual maintenance operation** — never called automatically on every request.
- Triggering: run monthly via an admin action or a scheduled cron once the dataset exceeds ~500 000 rows (estimated in 7+ years at current growth rate).

### inventory_movements (DB-02)

**Archive to a shadow table after 36 months (3 years).**  
The `archive_old_inventory_movements(keepMonths int DEFAULT 36)` PostgreSQL function (migration `0018`) moves old rows to `inventory_movements_archive`, which has the same schema but is excluded from normal queries.

- The kardex query uses indexes `(worksite_id, performed_at)` and `(product_id, performed_at)` (already in schema) — performance is acceptable up to ~500 000 rows.
- Archive only when the table exceeds ~200 000 rows or kardex queries exceed 500ms (not expected for 3+ years at current scale).

### No partitioning

PostgreSQL declarative partitioning (`PARTITION BY RANGE`) requires re-creating the table and all FK references. The complexity is not justified at this scale (~50 users, ~91 000 inventory_movements rows / year). Revisit if the deployment scales to multiple worksites with > 5× current volume.

---

## Application interface

```typescript
import { cleanupOldAuditLog, archiveOldInventoryMovements } from "@/lib/audit"

// Called by admin action or cron:
const deleted  = await cleanupOldAuditLog(6)          // default 6 years
const archived = await archiveOldInventoryMovements(36) // default 36 months
```

---

## Consequences

- `audit_log` entries are always available for at least 6 years — legal requirement met.
- `inventory_movements` older than 3 years are in `inventory_movements_archive` — kardex for recent stock remains fast.
- No automatic cleanup runs in production until an admin explicitly triggers it.
- Monitoring: add a monthly check `SELECT count(*) FROM audit_log WHERE created_at < now() - interval '6 years'` to know when cleanup is needed.

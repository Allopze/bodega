-- Migration 0025: Add is_global to roles table, add traceability:view permission
-- Run after deploying the code changes.

-- ── 1. Add is_global column to roles table ──────────────────────────────────

ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

-- Set is_global=true for roles that should see all worksites (no faena scoping).
-- These match the former GLOBAL_ROLES hardcoded set in lib/auth/scope.ts.
UPDATE roles SET is_global = TRUE WHERE name IN (
  'administrador', 'jefa_chome', 'secretaria', 'prevencionista', 'jefe_mantencion'
);

-- ── 2. Traceability module permission ───────────────────────────────────────

INSERT INTO permissions (id, name, module, description) VALUES
  ('p-trace-view', 'traceability:view', 'traceability', 'Ver trazabilidad de ítems')
ON CONFLICT (id) DO NOTHING;

-- Grant traceability:view to roles that previously used reports:view for this.
-- administrador already has all permissions via SYSTEM_PERMISSIONS seed.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'p-trace-view'
FROM roles r
WHERE r.name IN ('jefa_chome', 'secretaria', 'prevencionista', 'jefe_mantencion')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = 'p-trace-view'
  );

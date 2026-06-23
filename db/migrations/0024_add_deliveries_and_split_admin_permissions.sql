-- Migration 0024: Add deliveries permissions, split admin:config, add admin:manage_admins
-- This migration adds new permissions and their role grants.
-- Run after deploying the code changes in this PR.

-- ── New permissions ──────────────────────────────────────────────────────────

-- Deliveries module (previously depended on warehouse:register_movement)
INSERT INTO permissions (id, name, module, description) VALUES
  ('p-del-view',   'deliveries:view',   'deliveries', 'Ver historial de entregas'),
  ('p-del-create', 'deliveries:create', 'deliveries', 'Registrar entregas a trabajadores')
ON CONFLICT (id) DO NOTHING;

-- Split admin:config into granular permissions
INSERT INTO permissions (id, name, module, description) VALUES
  ('p-adm-smtp', 'admin:smtp',            'admin', 'Configurar servidor SMTP'),
  ('p-adm-tpl',  'admin:email_templates', 'admin', 'Gestionar plantillas de correo'),
  ('p-adm-mgt',  'admin:manage_admins',   'admin', 'Asignar roles y permisos de administración')
ON CONFLICT (id) DO NOTHING;

-- ── Role grants: Deliveries ──────────────────────────────────────────────────

-- administrador: all deliveries permissions (already has all via SYSTEM_PERMISSIONS seed)
-- jefa_chome: view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'rol-jefa', 'p-del-view'
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'rol-jefa')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'rol-jefa' AND permission_id = 'p-del-view');

-- secretaria: view + create
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'rol-sec', v.id FROM (VALUES ('p-del-view'), ('p-del-create')) AS v(id)
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'rol-sec')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'rol-sec' AND permission_id = v.id);

-- prevencionista: view + create
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'rol-prev', v.id FROM (VALUES ('p-del-view'), ('p-del-create')) AS v(id)
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'rol-prev')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'rol-prev' AND permission_id = v.id);

-- solicitante_faena: view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'rol-sol-faena', 'p-del-view'
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'rol-sol-faena')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'rol-sol-faena' AND permission_id = 'p-del-view');

-- prevencionista_faena: view + create
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'rol-prev-faena', v.id FROM (VALUES ('p-del-view'), ('p-del-create')) AS v(id)
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'rol-prev-faena')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'rol-prev-faena' AND permission_id = v.id);

-- ── Role grants: admin:smtp (only administrador) ────────────────────────────
-- administrador already has all permissions via SYSTEM_PERMISSIONS seed.
-- No other role gets admin:smtp by default.

-- ── Role grants: admin:email_templates (only administrador) ─────────────────
-- Same as admin:smtp — only administrador.

-- ── Role grants: admin:manage_admins (only administrador) ───────────────────
-- Same — only administrador.

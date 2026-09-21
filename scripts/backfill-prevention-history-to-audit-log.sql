-- Rescata al `audit_log` la historia de los diez historiales de prevención que
-- la migración 0319 borra.
--
-- POR QUÉ
-- El commit 60ba2571 migró las ESCRITURAS de once tablas `prevention_*_history`
-- al log compartido, y dice con todas sus letras: «Diez de las once eran la
-- ÚNICA traza que existía: sus servicios no llaman a `recordAudit` ni una vez».
-- Las filas anteriores nunca se copiaron. La 0319 dropea las tablas, y corre
-- dentro de la transacción automática del job `migrate` del deploy, así que no
-- hay ventana después: esto va ANTES, con las tablas todavía en pie.
--
-- `prevention_training_history` NO está acá, y no es un olvido: el mismo commit
-- registra que «duplicaba exactamente lo que el `recordAudit` de abajo ya
-- escribe… es el único que se retira sin migrar nada». Sus filas ya están.
--
-- CUÁNDO
--   1. Respaldo de la base.
--   2. Este script.
--   3. Recién entonces el deploy.
--
-- CÓMO
--   psql "$DATABASE_URL" -f scripts/backfill-prevention-history-to-audit-log.sql
--
-- Idempotente: el `id` se deriva del de origen (`histmig-<id>`), así que
-- reejecutar no duplica. Conserva `created_at` original — un rescate que fecha
-- todo hoy no es la historia, es el registro de haberla movido.
--
-- EL MAPEO replica `recordModuleHistory` (lib/audit.ts:188):
--   entity_type  ->  '<módulo>:' || entity_type
--   change_type  ->  dentro de new_state, junto a after_state y los extras
--   before_state ->  old_state (text; sólo si es objeto, como hace toAuditState)
--   actor_user_id -> user_id   ·   user_email queda nulo, igual que hoy
--   action       ->  derivada de change_type (deriveAuditAction, lib/audit.ts:234)
--
-- Los prefijos de módulo salen del commit y NO se deducen: el código tiene
-- duplicados (`hygiene`/`higiene`, `emergency`/`emergencias`,
-- `inspection`/`inspecciones`) y elegir el otro partiría la traza en dos.

BEGIN;

-- El verbo compartido, tal cual la escalera de regex de `deriveAuditAction`.
CREATE OR REPLACE FUNCTION pg_temp.audit_action(change_type text) RETURNS text AS $$
  SELECT CASE
    WHEN $1 ~ '^(created|imported|uploaded|registered)$'        THEN 'create'
    WHEN $1 ~ '^(deleted|deactivated|removed|annulled|archived)$' THEN 'delete'
    WHEN $1 ~ 'cancel'                                          THEN 'cancel'
    WHEN $1 ~ '(status|state)_changed$'                         THEN 'status_change'
    ELSE 'update'
  END
$$ LANGUAGE sql IMMUTABLE;

-- `toAuditState` descarta lo que no sea objeto (arrays incluidos).
CREATE OR REPLACE FUNCTION pg_temp.audit_state(value jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN jsonb_typeof($1) = 'object' THEN $1 ELSE '{}'::jsonb END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.audit_old_state(value jsonb) RETURNS text AS $$
  SELECT CASE WHEN jsonb_typeof($1) = 'object' THEN $1::text ELSE NULL END
$$ LANGUAGE sql IMMUTABLE;

/* ── Los siete de forma uniforme ──────────────────────────────────────────── */

INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, NULL, pg_temp.audit_action(h.change_type),
       m.modulo || ':' || h.entity_type, h.entity_id, NULL,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type) || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM (
  SELECT 'change'     AS modulo, * FROM prevention_change_history
  UNION ALL SELECT 'governance', * FROM prevention_governance_history
  UNION ALL SELECT 'emergency',  * FROM prevention_emergency_history
  UNION ALL SELECT 'epp',        * FROM prevention_epp_history
  UNION ALL SELECT 'hygiene',    * FROM prevention_hygiene_history
  UNION ALL SELECT 'inspection', * FROM prevention_inspection_history
) AS h
CROSS JOIN LATERAL (SELECT h.modulo) AS m(modulo)
ON CONFLICT (id) DO NOTHING;

/* ── Riesgo y legal: su `domain` viaja dentro del prefijo ─────────────────────
 * Su envoltorio hace `module: "risk_legal:${domain}"`
 * (lib/services/prevention-risk-legal.ts:100), así que el prefijo tiene tres
 * segmentos: `risk_legal:<domain>:<entityType>`. */
INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, NULL, pg_temp.audit_action(h.change_type),
       'risk_legal:' || h.domain || ':' || h.entity_type, h.entity_id, NULL,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type) || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM prevention_risk_legal_history h
ON CONFLICT (id) DO NOTHING;

/* ── Coordinación externa: sin `entity_type`; su escritor usa 'engagement' ─── */
INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, NULL, pg_temp.audit_action(h.change_type),
       'external_engagement:engagement', h.engagement_id, NULL,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type) || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM prevention_external_engagement_history h
ON CONFLICT (id) DO NOTHING;

/* ── Permisos de trabajo ──────────────────────────────────────────────────────
 * Sin `entity_type` ni `worksite_id`. La transición viaja tipada dentro del
 * estado, igual que hoy: `extra: { fromStatus, toStatus }`. El alcance por faena
 * se pierde porque la tabla nunca lo tuvo; derivarlo con un JOIN al permiso
 * fallaría para los borrados, que son justo los que sólo viven en la traza. */
INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, NULL, pg_temp.audit_action(h.change_type),
       'permit:permit', h.permit_id, NULL,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type)
         || jsonb_build_object('fromStatus', h.from_status, 'toStatus', h.to_status)
         || pg_temp.audit_state(h.after_state))::text,
       h.reason, NULL, h.created_at
FROM prevention_permit_history h
ON CONFLICT (id) DO NOTHING;

/* ── Indicadores de seguridad: `year` y `month` son su dimensión propia ────── */
INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, NULL, pg_temp.audit_action(h.change_type),
       'safety_indicator:' || h.entity_type, h.entity_id, NULL,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type)
         || jsonb_build_object('year', h.year, 'month', h.month)
         || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM safety_indicator_history h
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verificación: cada prefijo debe traer exactamente las filas de su tabla.
SELECT split_part(entity_type, ':', 1) AS modulo, count(*) AS rescatadas
FROM audit_log WHERE id LIKE 'histmig-%'
GROUP BY 1 ORDER BY 1;

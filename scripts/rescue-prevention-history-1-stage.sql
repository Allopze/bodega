-- FASE 1 de 2 — copia a una tabla de paso la historia que la 0319 va a borrar.
--
-- POR QUÉ DOS FASES. El rescate tiene que correr ANTES de la 0319, que dropea
-- las diez tablas origen. Pero su destino, `audit_log.worksite_id`, lo CREA la
-- 0318 — y el migrador aplica todas las pendientes en una sola transacción, así
-- que no existe ningún instante en que las tablas origen y esa columna coexistan.
-- De ahí la tabla de paso: acá se copia todo mientras el origen vive, y la fase 2
-- lo vuelca al `audit_log` una vez que la columna existe.
--
-- (Se intentó en un solo paso el 2026-09-21 y el deploy murió con «column
-- worksite_id of relation audit_log does not exist», sin tocar nada.)
--
-- El commit 60ba2571 migró las ESCRITURAS de once tablas `prevention_*_history`
-- al log compartido y dice con todas sus letras: «Diez de las once eran la ÚNICA
-- traza que existía: sus servicios no llaman a `recordAudit` ni una vez». Las
-- filas anteriores nunca se copiaron.
--
-- `prevention_training_history` NO está acá, y no es un olvido: el mismo commit
-- registra que «duplicaba exactamente lo que el `recordAudit` de abajo ya
-- escribe… es el único que se retira sin migrar nada». Sus filas ya están.
--
--   psql "$DATABASE_URL" -f scripts/rescue-prevention-history-1-stage.sql
--
-- Idempotente: el `id` se deriva del de origen (`histmig-<id>`), así que
-- reejecutar no duplica. Conserva `created_at` original — un rescate que fecha
-- todo hoy no es la historia, es el registro de haberla movido.
--
-- ENSAYADO el 2026-09-21 contra una copia con la forma de producción (su
-- `audit_log` todavía sin `worksite_id`): las dos fases de punta a punta, cada
-- una dos veces; las cinco ramas de `deriveAuditAction` contrastadas contra
-- lib/audit.ts:234; `before_state` array -> NULL; y referencias colgadas a un
-- usuario y a una faena borrados, que sin el `CASE` de la fase 2 habrían
-- abortado el volcado entero por FK.
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

/* La tabla de paso. Sin claves foráneas a propósito: el origen puede referir a
 * un usuario o una faena que ya no están, y acá sólo se guarda. La fase 2 es la
 * que decide qué hacer con esas referencias antes de entrar al `audit_log`. */
CREATE TABLE IF NOT EXISTS prevention_history_rescue (
  id          text PRIMARY KEY,
  user_id     text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  old_state   text,
  new_state   text,
  reason      text,
  worksite_id text,
  created_at  timestamptz NOT NULL
);

/* ── Las seis de forma uniforme ───────────────────────────────────────────────
 * Las columnas van nombradas y no `*`: hoy las seis coinciden en orden —se
 * comprobó contra el SQL de las migraciones 0082/0083/0084/0093/0094/0095, y
 * ninguna ALTER posterior las tocó— pero un `*` haría que cualquier divergencia
 * futura desalineara columnas del mismo tipo EN SILENCIO. */

INSERT INTO prevention_history_rescue (id, user_id, action, entity_type, entity_id,
                       old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, pg_temp.audit_action(h.change_type),
       h.modulo || ':' || h.entity_type, h.entity_id,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type) || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM (
  SELECT    'change' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_change_history
  UNION ALL SELECT 'governance' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_governance_history
  UNION ALL SELECT 'emergency' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_emergency_history
  UNION ALL SELECT 'epp' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_epp_history
  UNION ALL SELECT 'hygiene' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_hygiene_history
  UNION ALL SELECT 'inspection' AS modulo, id, entity_type, entity_id, worksite_id, change_type, reason, before_state, after_state, actor_user_id, created_at
    FROM prevention_inspection_history
) AS h
ON CONFLICT (id) DO NOTHING;

/* ── Riesgo y legal: su `domain` viaja dentro del prefijo ─────────────────────
 * Su envoltorio hace `module: "risk_legal:${domain}"`
 * (lib/services/prevention-risk-legal.ts:100), así que el prefijo tiene tres
 * segmentos: `risk_legal:<domain>:<entityType>`. */
INSERT INTO prevention_history_rescue (id, user_id, action, entity_type, entity_id,
                       old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, pg_temp.audit_action(h.change_type),
       'risk_legal:' || h.domain || ':' || h.entity_type, h.entity_id,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type) || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM prevention_risk_legal_history h
ON CONFLICT (id) DO NOTHING;

/* ── Coordinación externa: sin `entity_type`; su escritor usa 'engagement' ─── */
INSERT INTO prevention_history_rescue (id, user_id, action, entity_type, entity_id,
                       old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, pg_temp.audit_action(h.change_type),
       'external_engagement:engagement', h.engagement_id,
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
INSERT INTO prevention_history_rescue (id, user_id, action, entity_type, entity_id,
                       old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, pg_temp.audit_action(h.change_type),
       'permit:permit', h.permit_id,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type)
         || jsonb_build_object('fromStatus', h.from_status, 'toStatus', h.to_status)
         || pg_temp.audit_state(h.after_state))::text,
       h.reason, NULL, h.created_at
FROM prevention_permit_history h
ON CONFLICT (id) DO NOTHING;

/* ── Indicadores de seguridad: `year` y `month` son su dimensión propia ────── */
INSERT INTO prevention_history_rescue (id, user_id, action, entity_type, entity_id,
                       old_state, new_state, reason, worksite_id, created_at)
SELECT 'histmig-' || h.id, h.actor_user_id, pg_temp.audit_action(h.change_type),
       'safety_indicator:' || h.entity_type, h.entity_id,
       pg_temp.audit_old_state(h.before_state),
       (jsonb_build_object('changeType', h.change_type)
         || jsonb_build_object('year', h.year, 'month', h.month)
         || pg_temp.audit_state(h.after_state))::text,
       h.reason, h.worksite_id, h.created_at
FROM safety_indicator_history h
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verificación: cada prefijo debe traer exactamente las filas de su tabla.
SELECT split_part(entity_type, ':', 1) AS modulo, count(*) AS en_paso
FROM prevention_history_rescue
GROUP BY 1 ORDER BY 1;

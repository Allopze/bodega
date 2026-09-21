-- FASE 2 de 2 — vuelca al `audit_log` lo que la fase 1 dejó en la tabla de paso.
--
-- Corre DESPUÉS del migrador, que es cuando existe `audit_log.worksite_id` (la
-- crea la 0318). La fase 1 tuvo que correr antes, porque la 0319 —de la misma
-- transacción— dropea las tablas origen. Ese cruce es la razón de que esto sean
-- dos pasos y no uno; está explicado en la cabecera de la fase 1.
--
--   psql "$DATABASE_URL" -f scripts/rescue-prevention-history-2-flush.sql
--
-- Idempotente: los ids ya vienen derivados del origen, así que `ON CONFLICT DO
-- NOTHING` basta. La tabla de paso se borra al final y dentro de la MISMA
-- transacción: si el volcado falla, el paso sobrevive y se puede reintentar.

BEGIN;

/* `user_id` y `worksite_id` del `audit_log` son claves foráneas. La traza puede
 * nombrar a un usuario o una faena que ya no existen —de eso se trata guardar
 * historia— y una FK rota abortaría el volcado entero en el peor momento. Se
 * anula la referencia y se conserva la fila: la bitácora sobrevive a la faena,
 * igual que sobrevive al usuario. Es la misma razón por la que `user_email`
 * está denormalizado en esa tabla. */
INSERT INTO audit_log (id, user_id, user_email, action, entity_type, entity_id,
                       entity_code, old_state, new_state, reason, worksite_id, created_at)
SELECT
  r.id,
  CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id) THEN r.user_id END,
  NULL,
  r.action,
  r.entity_type,
  r.entity_id,
  NULL,
  r.old_state,
  r.new_state,
  r.reason,
  CASE WHEN EXISTS (SELECT 1 FROM worksites w WHERE w.id = r.worksite_id) THEN r.worksite_id END,
  r.created_at
FROM prevention_history_rescue r
ON CONFLICT (id) DO NOTHING;

DROP TABLE prevention_history_rescue;

COMMIT;

-- Verificación: lo rescatado, por módulo, ya en su destino definitivo.
SELECT split_part(entity_type, ':', 1) AS modulo, count(*) AS rescatadas
FROM audit_log WHERE id LIKE 'histmig-%'
GROUP BY 1 ORDER BY 1;

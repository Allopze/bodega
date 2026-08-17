-- Repunte de dotación: faenas viejas (inactivas) → faenas nuevas (activas).
--
-- Contexto: en producción los 146 trabajadores activos quedaron colgando de
-- faenas desactivadas. Alguien creó el juego nuevo de faenas y movió el stock,
-- pero nunca repuntó `workers.worksite_id`. Como el selector de bodega sólo
-- lista faenas activas y `registerWorkerStockDelivery` exige que el trabajador
-- pertenezca a la faena de la bodega, hoy NO se puede entregar EPP a nadie.
--
-- Sin COMMIT a propósito: lee las verificaciones del final y confirma tú.

BEGIN;

-- ── 0. Preflight ────────────────────────────────────────────────────────────
-- Léelo antes de mirar nada más. Si `Horcones` aparece con is_active = t, sus
-- trabajadores ya están bien y no necesitan repunte. Si aparece con f, avísame:
-- el paso 2 no la toca.
SELECT w.name,
       w.is_active,
       count(wk.id) FILTER (WHERE wk.is_active) AS trab_activos
  FROM worksites w
  LEFT JOIN workers wk ON wk.worksite_id = w.id
 GROUP BY w.name, w.is_active
 ORDER BY w.name;

-- ── 1. Pacífico: baja de los 35 ─────────────────────────────────────────────
-- La faena ya no existe como operación, así que su dotación deja de ser
-- vigente. No se les cambia de faena: quedan en la histórica, inactivos, para
-- no inventar una pertenencia que nunca tuvieron.
UPDATE workers wk
   SET is_active = false
  FROM worksites w
 WHERE wk.worksite_id = w.id
   AND w.name = 'Pacifico'
   AND wk.is_active;

-- ── 2. Repunte de las correspondencias confirmadas ──────────────────────────
UPDATE workers wk
   SET worksite_id = nuevo.id
  FROM worksites viejo, worksites nuevo
 WHERE wk.worksite_id = viejo.id
   AND wk.is_active
   AND viejo.is_active = false
   AND nuevo.is_active = true
   AND viejo.id <> nuevo.id
   AND (viejo.name, nuevo.name) IN (
     ('Cholguan',       'Cholguan - Arauco'),
     ('Santa Fe Gruas', 'Santa Fe - Grúas'),
     ('Teno',           'Teno - Arauco'),
     ('Biodiversa',     'Biodiversa'),
     ('Masisa',         'Masisa'),
     ('Administración', 'Oficina Central')
   );

-- ── 3. Verificación: dotación por faena ─────────────────────────────────────
-- Las faenas activas de destino deben quedar con gente; sus homónimas viejas
-- en cero. Pacifico debe quedar en cero activos.
SELECT w.name,
       w.is_active,
       count(wk.id) FILTER (WHERE wk.is_active) AS trab_activos
  FROM worksites w
  LEFT JOIN workers wk ON wk.worksite_id = w.id
 GROUP BY w.name, w.is_active
 ORDER BY w.name;

-- ── 4. Verificación: quién sigue huérfano ───────────────────────────────────
-- Esperado: sólo `Arauco Horcones` (2), que quedó sin destino definido.
-- Cualquier otro nombre aquí significa que el mapeo dejó a alguien fuera —
-- no hagas COMMIT sin resolverlo.
SELECT viejo.name AS faena_inactiva, count(*) AS trabajadores_activos_huerfanos
  FROM workers wk
  JOIN worksites viejo ON viejo.id = wk.worksite_id
 WHERE wk.is_active AND viejo.is_active = false
 GROUP BY viejo.name
 ORDER BY count(*) DESC;

-- ── 5. Verificación: faenas listas para entregar ────────────────────────────
-- Una entrega sólo es posible donde coinciden dotación activa y stock físico.
SELECT w.name,
       count(DISTINCT wk.id) FILTER (WHERE wk.is_active)  AS dotacion,
       count(DISTINCT s.product_id) FILTER (WHERE s.quantity > 0) AS productos_con_stock
  FROM worksites w
  LEFT JOIN workers wk       ON wk.worksite_id = w.id
  LEFT JOIN worksite_stock s ON s.worksite_id  = w.id
 WHERE w.is_active
 GROUP BY w.name
 ORDER BY w.name;

-- COMMIT;
-- ROLLBACK;

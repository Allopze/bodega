-- COM-002 (auditoría 2026-09-14): la casilla «el medidor fue reemplazado»
-- desactivaba la validación de regresión de la lectura y no quedaba registrada
-- en ninguna parte: no había columna, y ni el insert ni el update la incluían.
-- La carga aparecía después como una lectura normal, y el rendimiento por
-- equipo, el consumo por kilómetro y las reglas de anomalía de medidor se
-- calculaban sobre una serie partida sin saberlo.
--
-- La declaración se persiste y exige motivo con el umbral único de la
-- plataforma (REASON_MIN_LENGTH = 10): apagar el control parte la serie del
-- equipo y ese tramo no se reconstruye.
ALTER TABLE "fuel_loads"
  ADD COLUMN IF NOT EXISTS "meter_replaced" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "meter_replacement_reason" text;

ALTER TABLE "fuel_loads"
  DROP CONSTRAINT IF EXISTS "fuel_loads_meter_replacement_justified";

ALTER TABLE "fuel_loads"
  ADD CONSTRAINT "fuel_loads_meter_replacement_justified" CHECK (
    ("meter_replaced" = false AND "meter_replacement_reason" IS NULL)
    -- Sin el IS NOT NULL explícito, un reemplazo declarado sin motivo evaluaba
    -- a NULL y un CHECK que no es FALSE deja pasar la fila: exactamente el
    -- agujero que COM-002 describe, sólo que un nivel más abajo.
    OR ("meter_replaced" = true AND "meter_replacement_reason" IS NOT NULL
        AND length(btrim("meter_replacement_reason")) >= 10)
  );

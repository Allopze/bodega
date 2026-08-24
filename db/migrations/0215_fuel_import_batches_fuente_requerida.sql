-- `fuel_import_batches.fuente` pasa a NOT NULL.
--
-- Escrita a mano y no con `drizzle-kit generate`: hay otra sesión editando el
-- árbol y `generate` migra el esquema entero, no sólo esto.
--
-- El guard de "import ajeno" de las sincronizaciones filtra con
-- `fuente NOT IN (fuentes automáticas)`, y en SQL eso NO matchea NULL: un lote
-- sin fuente no bloqueaba la sincronización de esa faena y ese período, así que
-- sus litros y su monto se contaban dos veces. El `?? 'sin fuente'` que ambos
-- syncs tenían para ese caso era código muerto por la misma razón.
--
-- Relajar el predicado sería peor: un lote legacy sin fuente pasaría a bloquear
-- esa faena para siempre y el guard no tiene salida. El arreglo es que la
-- columna no admita NULL.
--
-- Los tres escritores de la aplicación ya ponen valor siempre
-- (`copec-sync`, `aramco-sync`, `actions-consumos`). El guard de abajo aborta
-- nombrando los lotes si quedara alguno histórico, en vez de fallar con un
-- error opaco de constraint.
DO $$
DECLARE huerfanos text;
BEGIN
  SELECT string_agg(id, ', ') INTO huerfanos
  FROM fuel_import_batches
  WHERE fuente IS NULL;
  IF huerfanos IS NOT NULL THEN
    RAISE EXCEPTION 'Lotes de combustible sin fuente: %. Asígnales una antes de migrar.', huerfanos;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "fuel_import_batches" ALTER COLUMN "fuente" SET NOT NULL;

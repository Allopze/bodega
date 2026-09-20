-- Retira el lado de llenado del motor de checklist del PDTP (2026-09-20).
--
-- Los instrumentos viven en el motor de inspecciones desde el 2026-08-12 (D10):
-- tiene sujeto inspeccionado, hallazgos derivados, revisión independiente y el
-- conector que acredita el programa anual solo. Las dos tablas de acá eran la
-- vía de entrada del motor viejo —la instancia llenada y sus respuestas— y
-- estaban en CERO filas, verificado en producción y en dev antes de borrarlas.
--
-- `pdtp_activity_checklists` NO se borra, a propósito. Tiene 9 filas en
-- producción y está DENTRO de la huella firmada del programa: `content-digest.ts`
-- emite una clave `checklists` construida desde ella, sin condicionar por
-- `schemaVersion`, y los snapshots ya firmados la contienen. Borrarla obligaba a
-- subir `MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION`, dejando sin verificar
-- todo programa firmado entre v12 y v17. Queda como artefacto de sólo lectura:
-- sus filas nacen únicamente al copiar hacia adelante un snapshot ya firmado.
--
-- `IF EXISTS` para que la migración sea reaplicable; hija antes que madre.
DROP TABLE IF EXISTS "pdtp_execution_checklist_responses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pdtp_execution_checklists" CASCADE;

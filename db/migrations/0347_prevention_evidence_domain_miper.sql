-- MIPER F2 (§7.6): la evidencia de una ocurrencia del Programa de Trabajo usa
-- el dominio `miper` de `prevention_evidence_uploads`. El CHECK de la tabla se
-- amplía acá y no en la 0346 —ya aplicada en la base de desarrollo, editarla no
-- volvería a ejecutarse— y el `DROP` va con `IF EXISTS` para que el archivo sea
-- idempotente si se reejecuta sobre una base a medio migrar.
ALTER TABLE "prevention_evidence_uploads" DROP CONSTRAINT IF EXISTS "prevention_evidence_uploads_domain_check";--> statement-breakpoint
ALTER TABLE "prevention_evidence_uploads" ADD CONSTRAINT "prevention_evidence_uploads_domain_check" CHECK ("prevention_evidence_uploads"."domain" IN ('campaign', 'cgrd', 'hygiene', 'capa', 'miper'));

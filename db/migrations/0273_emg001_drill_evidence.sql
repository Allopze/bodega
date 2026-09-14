-- EMG-001 (auditoría 2026-09-14), patrón P4: el cierre de un simulacro no tenía
-- dónde adjuntar el respaldo del propio simulacro, y el conector PDTP acreditaba
-- la actividad con un rótulo sintético. El acta o el registro fotográfico es la
-- prueba que se exhibe en una fiscalización.
ALTER TABLE "prevention_emergency_drills"
  ADD COLUMN IF NOT EXISTS "evidence_path" text,
  ADD COLUMN IF NOT EXISTS "evidence_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills"
  ADD CONSTRAINT "prevention_emergency_drill_evidence_complete" CHECK (
    ("evidence_path" IS NULL AND "evidence_checksum_sha256" IS NULL)
    OR ("evidence_path" IS NOT NULL AND length("evidence_checksum_sha256") = 64)
  );

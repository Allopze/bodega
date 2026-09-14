-- INC-001 (auditoría 2026-09-14): no existía canal de reporte de incidentes
-- para el trabajador ni vía anónima. Reportar exigía
-- `prevention:incidents:report`, concedido sólo a roles internos, y la única
-- superficie pública de Prevención era el PPA —que cubre detener una tarea
-- antes de empezarla, no comunicar un hecho ya ocurrido—.
--
-- Esta tabla es el buzón público, no el expediente. Y la vía anónima es
-- anónima de verdad: no hay columna de usuario, sesión, IP ni user agent, y
-- nada en la acción pública las audita junto al reporte. Un canal de denuncia
-- rastreable no es un canal de denuncia.
CREATE TABLE IF NOT EXISTS prevention_incident_public_reports (
  id                 text PRIMARY KEY,
  code               text NOT NULL UNIQUE,
  worksite_id        text NOT NULL REFERENCES worksites(id) ON DELETE RESTRICT,
  category           text NOT NULL,
  occurred_at        text NOT NULL,
  location           text NOT NULL,
  narrative          text NOT NULL,
  is_anonymous       boolean NOT NULL DEFAULT true,
  reporter_name      text,
  reporter_contact   text,
  status             text NOT NULL DEFAULT 'pending',
  triaged_by_user_id text,
  triaged_at         timestamptz,
  triage_notes       text,
  incident_id        text,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  -- Nombradas a mano: el nombre que Postgres derivaría de la tabla pasa de 63
  -- caracteres y lo truncaría en silencio, dejando un `DROP CONSTRAINT` futuro
  -- apuntando a un nombre que no existe.
  CONSTRAINT prevention_incident_public_reports_triaged_by_fk
    FOREIGN KEY (triaged_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT prevention_incident_public_reports_incident_fk
    FOREIGN KEY (incident_id) REFERENCES prevention_incidents(id) ON DELETE SET NULL,
  CONSTRAINT prevention_incident_public_report_category_valid
    CHECK (category IN ('cuasi_accidente', 'condicion_insegura', 'acto_inseguro', 'accidente', 'otro')),
  CONSTRAINT prevention_incident_public_report_status_valid
    CHECK (status IN ('pending', 'triaged', 'discarded')),
  CONSTRAINT prevention_incident_public_report_anonymous_has_no_identity
    CHECK (is_anonymous = false OR (reporter_name IS NULL AND reporter_contact IS NULL)),
  CONSTRAINT prevention_incident_public_report_triage_consistent
    CHECK (
      (status = 'pending' AND triaged_at IS NULL AND triaged_by_user_id IS NULL)
      OR (status <> 'pending' AND triaged_at IS NOT NULL AND triaged_by_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS prevention_incident_public_reports_status_idx
  ON prevention_incident_public_reports (status, created_at);
CREATE INDEX IF NOT EXISTS prevention_incident_public_reports_worksite_idx
  ON prevention_incident_public_reports (worksite_id, created_at);

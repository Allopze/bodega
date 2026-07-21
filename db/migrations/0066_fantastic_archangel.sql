CREATE TABLE "prevention_capa_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_legacy_action_id" text,
	"worksite_id" text NOT NULL,
	"finding" text NOT NULL,
	"immediate_measure" text,
	"root_cause" text,
	"action_description" text NOT NULL,
	"responsible_user_id" text,
	"responsible_snapshot" text,
	"responsible_role" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"target_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence_required" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"started_by_user_id" text,
	"started_at" timestamp with time zone,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"effectiveness_status" text DEFAULT 'pending' NOT NULL,
	"effectiveness_assessment" text,
	"effectiveness_assessed_by_user_id" text,
	"effectiveness_assessed_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"reopened_at" timestamp with time zone,
	"reopened_reason" text,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"reconciliation_status" text DEFAULT 'reconciled' NOT NULL,
	"legacy_snapshot" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_capa_actions_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'manual')),
	CONSTRAINT "prevention_capa_priority_valid" CHECK ("prevention_capa_actions"."priority" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "prevention_capa_status_valid" CHECK ("prevention_capa_actions"."status" IN ('pending', 'in_progress', 'pending_verification', 'verified', 'closed', 'reopened', 'cancelled')),
	CONSTRAINT "prevention_capa_effectiveness_valid" CHECK ("prevention_capa_actions"."effectiveness_status" IN ('pending', 'effective', 'ineffective', 'not_required', 'legacy_not_assessed')),
	CONSTRAINT "prevention_capa_reconciliation_valid" CHECK ("prevention_capa_actions"."reconciliation_status" IN ('reconciled', 'needs_assignment', 'needs_evidence', 'needs_review')),
	CONSTRAINT "prevention_capa_version_positive" CHECK ("prevention_capa_actions"."version" >= 1),
	CONSTRAINT "prevention_capa_reopen_consistent" CHECK (("prevention_capa_actions"."reopened_at" IS NULL AND "prevention_capa_actions"."reopened_by_user_id" IS NULL AND "prevention_capa_actions"."reopened_reason" IS NULL) OR ("prevention_capa_actions"."reopened_at" IS NOT NULL AND "prevention_capa_actions"."reopened_by_user_id" IS NOT NULL AND length("prevention_capa_actions"."reopened_reason") >= 5)),
	CONSTRAINT "prevention_capa_cancel_consistent" CHECK (("prevention_capa_actions"."cancelled_at" IS NULL AND "prevention_capa_actions"."cancelled_by_user_id" IS NULL AND "prevention_capa_actions"."cancellation_reason" IS NULL) OR ("prevention_capa_actions"."cancelled_at" IS NOT NULL AND "prevention_capa_actions"."cancelled_by_user_id" IS NOT NULL AND length("prevention_capa_actions"."cancellation_reason") >= 5))
);
--> statement-breakpoint
CREATE TABLE "prevention_capa_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"description" text,
	"checksum_sha256" text,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_capa_evidence_kind_valid" CHECK ("prevention_capa_evidence"."kind" IN ('document', 'photo', 'url', 'note')),
	CONSTRAINT "prevention_capa_evidence_checksum_valid" CHECK ("prevention_capa_evidence"."checksum_sha256" IS NULL OR length("prevention_capa_evidence"."checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_capa_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"note" text NOT NULL,
	"progress" integer,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_capa_followup_progress_valid" CHECK ("prevention_capa_followups"."progress" IS NULL OR "prevention_capa_followups"."progress" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "prevention_capa_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"change_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"change_set" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_capa_transition_type_valid" CHECK ("prevention_capa_transitions"."change_type" IN ('created', 'status', 'assignment', 'target_date', 'priority', 'evidence', 'followup', 'backfill'))
);
--> statement-breakpoint
ALTER TABLE "sst_action_plan" ADD COLUMN "capa_action_id" text;--> statement-breakpoint
ALTER TABLE "ppa_corrective_actions" ADD COLUMN "capa_action_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD COLUMN "capa_action_id" text;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_effectiveness_assessed_by_user_id_users_id_fk" FOREIGN KEY ("effectiveness_assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_actions_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD CONSTRAINT "prevention_capa_evidence_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD CONSTRAINT "prevention_capa_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_followups" ADD CONSTRAINT "prevention_capa_followups_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_followups" ADD CONSTRAINT "prevention_capa_followups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_transitions" ADD CONSTRAINT "prevention_capa_transitions_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_transitions" ADD CONSTRAINT "prevention_capa_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_legacy_source_unique" ON "prevention_capa_actions" USING btree ("source_type","source_legacy_action_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_worksite_status_idx" ON "prevention_capa_actions" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_capa_source_idx" ON "prevention_capa_actions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_responsible_status_idx" ON "prevention_capa_actions" USING btree ("responsible_user_id","status");--> statement-breakpoint
CREATE INDEX "prevention_capa_target_date_idx" ON "prevention_capa_actions" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "prevention_capa_evidence_action_idx" ON "prevention_capa_evidence" USING btree ("action_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_capa_followup_action_idx" ON "prevention_capa_followups" USING btree ("action_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_capa_transition_action_idx" ON "prevention_capa_transitions" USING btree ("action_id","created_at");--> statement-breakpoint
ALTER TABLE "sst_action_plan" ADD CONSTRAINT "sst_action_plan_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_corrective_actions" ADD CONSTRAINT "ppa_corrective_actions_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sst_action_plan_capa_unique" ON "sst_action_plan" USING btree ("capa_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppa_corrective_actions_capa_unique" ON "ppa_corrective_actions" USING btree ("capa_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_action_plan_capa_unique" ON "pdtp_action_plan" USING btree ("capa_action_id");
--> statement-breakpoint
-- Backfill CAPA aditivo e idempotente. Conserva las tablas legadas y deja
-- cualquier ambigüedad de responsable/evidencia en cola de conciliación.
INSERT INTO "prevention_capa_actions" (
  "id", "code", "source_type", "source_id", "source_legacy_action_id",
  "worksite_id", "finding", "action_description", "responsible_user_id",
  "responsible_snapshot", "responsible_role", "priority", "target_date",
  "status", "evidence_required", "created_by_user_id", "verified_by_user_id",
  "verified_at", "closed_by_user_id", "closed_at", "effectiveness_status",
  "reconciliation_status", "legacy_snapshot", "version", "created_at", "updated_at"
)
SELECT
  'capa-pdtp-' || a.id,
  'CAPA-PDTP-' || a.id,
  'pdtp', a.execution_id, a.id,
  e.worksite_id, a.hallazgo, a.accion, a.responsable_user_id,
  a.responsable, a.responsable_role,
  CASE a.prioridad WHEN 'alta' THEN 'high' WHEN 'baja' THEN 'low' ELSE 'medium' END,
  a.plazo,
  CASE a.estado
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completado' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed'
    WHEN 'reabierto' THEN 'reopened'
    ELSE 'pending'
  END,
  true, a.created_by_user_id,
  CASE WHEN a.estado = 'verificado' THEN a.verified_by_user_id END,
  CASE WHEN a.estado = 'verificado' THEN a.verified_at END,
  CASE WHEN a.estado = 'verificado' THEN a.verified_by_user_id END,
  CASE WHEN a.estado = 'verificado' THEN COALESCE(a.closed_at, a.verified_at) END,
  CASE WHEN a.estado = 'verificado' THEN 'legacy_not_assessed' ELSE 'pending' END,
  CASE
    WHEN a.responsable_user_id IS NULL THEN 'needs_assignment'
    WHEN a.estado IN ('completado', 'verificado') AND NOT EXISTS (
      SELECT 1 FROM pdtp_action_plan_followups f
      WHERE f.action_plan_item_id = a.id
        AND (NULLIF(f.evidencia_url, '') IS NOT NULL OR f.evidencia_photos <> '[]'::jsonb)
    ) THEN 'needs_evidence'
    ELSE 'needs_review'
  END,
  to_jsonb(a), 1, a.created_at, a.updated_at
FROM pdtp_action_plan a
JOIN pdtp_executions e ON e.id = a.execution_id
ON CONFLICT ("source_type", "source_legacy_action_id") DO NOTHING;
--> statement-breakpoint
UPDATE pdtp_action_plan legacy
SET capa_action_id = capa.id
FROM prevention_capa_actions capa
WHERE capa.source_type = 'pdtp'
  AND capa.source_legacy_action_id = legacy.id
  AND legacy.capa_action_id IS DISTINCT FROM capa.id;
--> statement-breakpoint
INSERT INTO prevention_capa_transitions (
  id, action_id, change_type, from_status, to_status, reason, change_set, actor_user_id, created_at
)
SELECT
  'capat-backfill-pdtp-' || a.id,
  'capa-pdtp-' || a.id,
  'backfill', NULL,
  CASE a.estado
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completado' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed'
    WHEN 'reabierto' THEN 'reopened'
    ELSE 'pending'
  END,
  'Migración aditiva desde pdtp_action_plan',
  jsonb_build_object('legacyStatus', a.estado, 'reconciliationRequired', true),
  a.created_by_user_id, a.created_at
FROM pdtp_action_plan a
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO prevention_capa_followups (id, action_id, note, progress, created_by_user_id, created_at)
SELECT
  'capaf-pdtp-' || f.id,
  'capa-pdtp-' || f.action_plan_item_id,
  COALESCE(NULLIF(f.observacion, ''), 'Seguimiento histórico PDTP: ' || f.estado_nuevo),
  NULL, f.updated_by_user_id, f.created_at
FROM pdtp_action_plan_followups f
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO prevention_capa_transitions (
  id, action_id, change_type, from_status, to_status, reason, change_set, actor_user_id, created_at
)
SELECT
  'capat-pdtp-followup-' || f.id,
  'capa-pdtp-' || f.action_plan_item_id,
  'status',
  CASE f.estado_anterior
    WHEN 'en_proceso' THEN 'in_progress' WHEN 'completado' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed' WHEN 'reabierto' THEN 'reopened'
    WHEN 'pendiente' THEN 'pending' ELSE NULL
  END,
  CASE f.estado_nuevo
    WHEN 'en_proceso' THEN 'in_progress' WHEN 'completado' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed' WHEN 'reabierto' THEN 'reopened'
    ELSE 'pending'
  END,
  f.observacion,
  jsonb_build_object('legacyFollowupId', f.id),
  f.updated_by_user_id, f.created_at
FROM pdtp_action_plan_followups f
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO prevention_capa_evidence (
  id, action_id, kind, reference, description, checksum_sha256, uploaded_by_user_id, created_at
)
SELECT
  'capae-pdtp-url-' || f.id,
  'capa-pdtp-' || f.action_plan_item_id,
  'url', f.evidencia_url, 'Evidencia URL migrada desde PDTP', NULL,
  f.updated_by_user_id, f.created_at
FROM pdtp_action_plan_followups f
WHERE NULLIF(f.evidencia_url, '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO prevention_capa_evidence (
  id, action_id, kind, reference, description, checksum_sha256, uploaded_by_user_id, created_at
)
SELECT
  'capae-pdtp-photos-' || f.id,
  'capa-pdtp-' || f.action_plan_item_id,
  'photo', f.evidencia_photos::text, 'Referencias fotográficas migradas desde PDTP', NULL,
  f.updated_by_user_id, f.created_at
FROM pdtp_action_plan_followups f
WHERE f.evidencia_photos <> '[]'::jsonb
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO "prevention_capa_actions" (
  "id", "code", "source_type", "source_id", "source_legacy_action_id",
  "worksite_id", "finding", "action_description", "responsible_snapshot",
  "priority", "target_date", "status", "evidence_required",
  "created_by_user_id", "effectiveness_status", "reconciliation_status",
  "legacy_snapshot", "version", "created_at", "updated_at"
)
SELECT
  'capa-sst-' || a.id,
  'CAPA-SST-' || a.id,
  'sst_evaluation', a.evaluation_id, a.id,
  e.worksite_id, a.hallazgo, a.accion, a.responsable,
  'medium', a.plazo,
  CASE lower(a.estado)
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completado' THEN 'pending_verification'
    WHEN 'completada' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed'
    WHEN 'verificada' THEN 'closed'
    WHEN 'cerrado' THEN 'closed'
    WHEN 'cerrada' THEN 'closed'
    ELSE 'pending'
  END,
  true, e.created_by,
  CASE WHEN lower(a.estado) IN ('verificado', 'verificada', 'cerrado', 'cerrada') THEN 'legacy_not_assessed' ELSE 'pending' END,
  'needs_assignment', to_jsonb(a), 1, e.created_at, e.updated_at
FROM sst_action_plan a
JOIN sst_evaluations e ON e.id = a.evaluation_id
ON CONFLICT ("source_type", "source_legacy_action_id") DO NOTHING;
--> statement-breakpoint
UPDATE sst_action_plan legacy
SET capa_action_id = capa.id
FROM prevention_capa_actions capa
WHERE capa.source_type = 'sst_evaluation'
  AND capa.source_legacy_action_id = legacy.id
  AND legacy.capa_action_id IS DISTINCT FROM capa.id;
--> statement-breakpoint
INSERT INTO prevention_capa_transitions (
  id, action_id, change_type, from_status, to_status, reason, change_set, actor_user_id, created_at
)
SELECT
  'capat-backfill-sst-' || a.id,
  'capa-sst-' || a.id,
  'backfill', NULL,
  CASE lower(a.estado)
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completado' THEN 'pending_verification'
    WHEN 'completada' THEN 'pending_verification'
    WHEN 'verificado' THEN 'closed'
    WHEN 'verificada' THEN 'closed'
    WHEN 'cerrado' THEN 'closed'
    WHEN 'cerrada' THEN 'closed'
    ELSE 'pending'
  END,
  'Migración aditiva desde sst_action_plan',
  jsonb_build_object('legacyStatus', a.estado, 'responsibleText', a.responsable),
  e.created_by, e.created_at
FROM sst_action_plan a
JOIN sst_evaluations e ON e.id = a.evaluation_id
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO "prevention_capa_actions" (
  "id", "code", "source_type", "source_id", "source_legacy_action_id",
  "worksite_id", "finding", "action_description", "responsible_snapshot",
  "responsible_role", "priority", "target_date", "status", "evidence_required",
  "created_by_user_id", "effectiveness_status", "reconciliation_status",
  "legacy_snapshot", "version", "created_at", "updated_at"
)
SELECT
  'capa-ppa-' || a.id,
  'CAPA-PPA-' || a.id,
  'ppa', a.ppa_id, a.id,
  a.worksite_id, s.worker_name || ' · ' || s.tipo_trabajo,
  a.description, a.responsible, a.responsible_role,
  CASE a.priority WHEN 'alta' THEN 'high' WHEN 'baja' THEN 'low' ELSE 'medium' END,
  a.due_date,
  CASE a.status
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completada' THEN 'pending_verification'
    WHEN 'verificada' THEN 'verified'
    WHEN 'cerrada' THEN 'closed'
    ELSE 'pending'
  END,
  true, a.created_by,
  CASE WHEN a.status = 'cerrada' THEN 'legacy_not_assessed' ELSE 'pending' END,
  CASE WHEN a.status IN ('completada', 'verificada', 'cerrada') THEN 'needs_evidence' ELSE 'needs_assignment' END,
  to_jsonb(a), 1, a.created_at, a.updated_at
FROM ppa_corrective_actions a
JOIN ppa_submissions s ON s.id = a.ppa_id
ON CONFLICT ("source_type", "source_legacy_action_id") DO NOTHING;
--> statement-breakpoint
UPDATE ppa_corrective_actions legacy
SET capa_action_id = capa.id
FROM prevention_capa_actions capa
WHERE capa.source_type = 'ppa'
  AND capa.source_legacy_action_id = legacy.id
  AND legacy.capa_action_id IS DISTINCT FROM capa.id;
--> statement-breakpoint
INSERT INTO prevention_capa_transitions (
  id, action_id, change_type, from_status, to_status, reason, change_set, actor_user_id, created_at
)
SELECT
  'capat-backfill-ppa-' || a.id,
  'capa-ppa-' || a.id,
  'backfill', NULL,
  CASE a.status
    WHEN 'en_proceso' THEN 'in_progress'
    WHEN 'completada' THEN 'pending_verification'
    WHEN 'verificada' THEN 'verified'
    WHEN 'cerrada' THEN 'closed'
    ELSE 'pending'
  END,
  'Migración aditiva desde ppa_corrective_actions',
  jsonb_build_object('legacyStatus', a.status, 'responsibleText', a.responsible),
  a.created_by, a.created_at
FROM ppa_corrective_actions a
ON CONFLICT (id) DO NOTHING;

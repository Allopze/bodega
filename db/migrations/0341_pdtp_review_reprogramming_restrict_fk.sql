-- Auditoría de production readiness 2026-09-28.
-- M-06: la reprogramación nace `pending_review`, igual que el "no aplica".
-- M-07: la faena de desvíos, subidas y metas por faena pasa a RESTRICT: una
--       faena con historial PDTP no se borra físicamente, sólo se da de baja.
-- M-09: el motivo de "no aplica"/cancelación de una ocurrencia exige 10
--       caracteres. NOT VALID: rige para toda escritura nueva sin reescribir
--       ni rechazar filas históricas que ya tuvieran un motivo más corto.
ALTER TABLE "pdtp_execution_deviations" DROP CONSTRAINT IF EXISTS "pdtp_execution_deviations_pending_review_kind_check";--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" DROP CONSTRAINT IF EXISTS "pdtp_scheduled_instances_not_applicable_reason_check";--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" DROP CONSTRAINT IF EXISTS "pdtp_scheduled_instances_cancel_reason_check";--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" DROP CONSTRAINT IF EXISTS "pdtp_activity_schedule_overrides_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_evidence_uploads" DROP CONSTRAINT IF EXISTS "pdtp_evidence_uploads_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" DROP CONSTRAINT IF EXISTS "pdtp_execution_deviations_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_activity_schedule_overrides_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_evidence_uploads" ADD CONSTRAINT "pdtp_evidence_uploads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_pending_review_kind_check" CHECK ("pdtp_execution_deviations"."status" NOT IN ('pending_review', 'rejected') OR "pdtp_execution_deviations"."kind" IN ('not_applicable', 'reprogrammed'));--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_not_applicable_reason_check" CHECK ("pdtp_scheduled_instances"."status" <> 'not_applicable' OR length(trim(COALESCE("pdtp_scheduled_instances"."not_applicable_reason", ''))) >= 10) NOT VALID;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_cancel_reason_check" CHECK ("pdtp_scheduled_instances"."status" <> 'cancelled' OR length(trim(COALESCE("pdtp_scheduled_instances"."cancellation_reason", ''))) >= 10) NOT VALID;
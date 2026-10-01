CREATE TABLE "prevention_risk_occurrence_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"evidence_upload_id" text NOT NULL,
	"description" text,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" text,
	"withdraw_reason" text,
	CONSTRAINT "prevention_risk_occurrence_evidence_withdraw_complete" CHECK ("prevention_risk_occurrence_evidence"."withdrawn_at" IS NULL OR ("prevention_risk_occurrence_evidence"."withdrawn_by_user_id" IS NOT NULL AND length(trim(coalesce("prevention_risk_occurrence_evidence"."withdraw_reason", ''))) >= 10))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_program_action_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"control_id" text NOT NULL,
	"linked_by_user_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_program_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"action_number" integer NOT NULL,
	"process_id" text,
	"description" text NOT NULL,
	"responsible_user_id" text,
	"responsible_snapshot" text,
	"location_label" text,
	"schedule_kind" text NOT NULL,
	"starts_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_program_actions_number_positive" CHECK ("prevention_risk_program_actions"."action_number" >= 1),
	CONSTRAINT "prevention_risk_program_actions_version_positive" CHECK ("prevention_risk_program_actions"."version" > 0),
	CONSTRAINT "prevention_risk_program_actions_schedule_valid" CHECK ("prevention_risk_program_actions"."schedule_kind" IN ('once', 'monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "prevention_risk_program_actions_status_valid" CHECK ("prevention_risk_program_actions"."status" IN ('active', 'retired')),
	CONSTRAINT "prevention_risk_program_actions_retired_complete" CHECK ("prevention_risk_program_actions"."status" <> 'retired' OR ("prevention_risk_program_actions"."retired_at" IS NOT NULL AND length(trim(coalesce("prevention_risk_program_actions"."retired_reason", ''))) >= 10))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_program_occurrence_records" (
	"id" text PRIMARY KEY NOT NULL,
	"occurrence_id" text NOT NULL,
	"outcome" text NOT NULL,
	"effective_on" text,
	"late" boolean DEFAULT false NOT NULL,
	"reason" text,
	"notes" text,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	CONSTRAINT "prevention_risk_program_occurrence_records_outcome_valid" CHECK ("prevention_risk_program_occurrence_records"."outcome" IN ('done', 'not_done')),
	CONSTRAINT "prevention_risk_program_occurrence_records_done_effective" CHECK ("prevention_risk_program_occurrence_records"."outcome" <> 'done' OR "prevention_risk_program_occurrence_records"."effective_on" IS NOT NULL),
	CONSTRAINT "prevention_risk_program_occurrence_records_not_done_reason" CHECK ("prevention_risk_program_occurrence_records"."outcome" <> 'not_done' OR length(trim(coalesce("prevention_risk_program_occurrence_records"."reason", ''))) >= 10),
	CONSTRAINT "prevention_risk_program_occurrence_records_void_complete" CHECK ("prevention_risk_program_occurrence_records"."voided_at" IS NULL OR ("prevention_risk_program_occurrence_records"."voided_by_user_id" IS NOT NULL AND length(trim(coalesce("prevention_risk_program_occurrence_records"."void_reason", ''))) >= 10))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_program_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"due_on" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"current_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_program_occurrences_outcome_valid" CHECK ("prevention_risk_program_occurrences"."outcome" IN ('pending', 'done', 'not_done', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"period" integer NOT NULL,
	"company_name" text,
	"company_rut" text,
	"company_address" text,
	"company_commune" text,
	"economic_activity" text,
	"adherent_number" text,
	"worksite_name" text,
	"site_representative_user_id" text,
	"site_representative_name" text,
	"headcount_total" integer,
	"headcount_male" integer,
	"headcount_female" integer,
	"headcount_other" integer,
	"program_manager_user_id" text,
	"elaborated_on" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_programs_period_valid" CHECK ("prevention_risk_programs"."period" BETWEEN 2000 AND 2100),
	CONSTRAINT "prevention_risk_programs_version_positive" CHECK ("prevention_risk_programs"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "prevention_risk_occurrence_evidence" ADD CONSTRAINT "prevention_occurrence_evidence_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."prevention_risk_program_occurrence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_occurrence_evidence" ADD CONSTRAINT "prevention_occurrence_evidence_upload_fk" FOREIGN KEY ("evidence_upload_id") REFERENCES "public"."prevention_evidence_uploads"("path") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_occurrence_evidence" ADD CONSTRAINT "prevention_occurrence_evidence_uploaded_by_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_occurrence_evidence" ADD CONSTRAINT "prevention_occurrence_evidence_withdrawn_by_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_action_controls" ADD CONSTRAINT "prevention_program_action_control_action_fk" FOREIGN KEY ("action_id") REFERENCES "public"."prevention_risk_program_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_action_controls" ADD CONSTRAINT "prevention_program_action_control_control_fk" FOREIGN KEY ("control_id") REFERENCES "public"."prevention_risk_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_action_controls" ADD CONSTRAINT "prevention_program_action_control_linked_by_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_actions" ADD CONSTRAINT "prevention_program_action_program_fk" FOREIGN KEY ("program_id") REFERENCES "public"."prevention_risk_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_actions" ADD CONSTRAINT "prevention_program_action_process_fk" FOREIGN KEY ("process_id") REFERENCES "public"."prevention_risk_processes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_actions" ADD CONSTRAINT "prevention_program_action_responsible_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_actions" ADD CONSTRAINT "prevention_program_action_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_occurrence_records" ADD CONSTRAINT "prevention_program_record_occurrence_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."prevention_risk_program_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_occurrence_records" ADD CONSTRAINT "prevention_program_record_recorded_by_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_occurrence_records" ADD CONSTRAINT "prevention_program_record_voided_by_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_occurrences" ADD CONSTRAINT "prevention_risk_program_occurrences_current_record_id_prevention_risk_program_occurrence_records_id_fk" FOREIGN KEY ("current_record_id") REFERENCES "public"."prevention_risk_program_occurrence_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_program_occurrences" ADD CONSTRAINT "prevention_program_occurrence_action_fk" FOREIGN KEY ("action_id") REFERENCES "public"."prevention_risk_program_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_programs" ADD CONSTRAINT "prevention_program_matrix_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_programs" ADD CONSTRAINT "prevention_program_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_programs" ADD CONSTRAINT "prevention_program_site_representative_fk" FOREIGN KEY ("site_representative_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_programs" ADD CONSTRAINT "prevention_program_manager_fk" FOREIGN KEY ("program_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_programs" ADD CONSTRAINT "prevention_program_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_program_action_controls_pair_unique" ON "prevention_risk_program_action_controls" USING btree ("action_id","control_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_program_actions_program_action_unique" ON "prevention_risk_program_actions" USING btree ("program_id","action_number");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_program_occurrences_action_due_unique" ON "prevention_risk_program_occurrences" USING btree ("action_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_programs_matrix_unique" ON "prevention_risk_programs" USING btree ("matrix_id");--> statement-breakpoint
-- Ocurrencias pendientes por actividad: es el índice del barrido de vencidas
-- (§7.5). Parcial porque sólo las `pending` se barren; las resueltas no.
CREATE INDEX IF NOT EXISTS "prevention_risk_program_occurrences_pending_idx" ON "prevention_risk_program_occurrences" USING btree ("action_id") WHERE "outcome" = 'pending';--> statement-breakpoint
-- Los registros de ejecución son de sólo inserción (§7.4): corregir un «Se hizo
-- / No se hizo» es anular con motivo y volver a registrar, jamás editar ni
-- borrar. El trigger permite únicamente COMPLETAR la anulación —y una sola vez—
-- y rechaza cualquier otro cambio de contenido, igual que la 0344 sella las
-- versiones de la matriz.
CREATE OR REPLACE FUNCTION prevention_risk_program_occurrence_records_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los registros de ejecución no se borran: anule el registro con motivo';
  END IF;
  IF NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.effective_on IS DISTINCT FROM OLD.effective_on
     OR NEW.late IS DISTINCT FROM OLD.late
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'Los registros de ejecución son de sólo inserción: anule el registro y vuelva a registrar';
  END IF;
  IF OLD.voided_at IS NOT NULL
     AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at
          OR NEW.voided_by_user_id IS DISTINCT FROM OLD.voided_by_user_id
          OR NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
    RAISE EXCEPTION 'Una anulación ya registrada no se corrige: anule otro registro';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevention_risk_program_occurrence_records_append_only_trg ON "prevention_risk_program_occurrence_records";--> statement-breakpoint
CREATE TRIGGER prevention_risk_program_occurrence_records_append_only_trg
  BEFORE UPDATE OR DELETE ON "prevention_risk_program_occurrence_records"
  FOR EACH ROW EXECUTE FUNCTION prevention_risk_program_occurrence_records_append_only();
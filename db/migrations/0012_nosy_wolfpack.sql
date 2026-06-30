CREATE TABLE "committee_agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"description" text NOT NULL,
	"responsible_id" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"held_at" timestamp with time zone,
	"attendees" jsonb NOT NULL,
	"agenda" text NOT NULL,
	"minutes_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_members" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committees" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'activo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"type" text NOT NULL,
	"version_id" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"expires_at" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"position" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"rut" text NOT NULL,
	"name" text NOT NULL,
	"legal_representative" text,
	"contact" text,
	"status" text DEFAULT 'activo' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contractors_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
CREATE TABLE "document_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"method" text DEFAULT 'digital' NOT NULL,
	"evidence_url" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"user_id" text NOT NULL,
	"signature" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "emergency_drills" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"type" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"attendees" integer,
	"findings" jsonb NOT NULL,
	"effectiveness" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"location" text NOT NULL,
	"last_inspection_at" timestamp with time zone,
	"next_inspection_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"version" integer NOT NULL,
	"threats" jsonb NOT NULL,
	"roles" jsonb NOT NULL,
	"routes" jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"leader_id" text NOT NULL,
	"members" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" text NOT NULL,
	"status" text DEFAULT 'vigente' NOT NULL,
	"findings" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_aptitudes" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"exam_id" text,
	"position" text NOT NULL,
	"aptitude" text NOT NULL,
	"restrictions" jsonb NOT NULL,
	"valid_until" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_exams" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"type" text NOT NULL,
	"protocol_id" text,
	"performed_at" text NOT NULL,
	"result" text DEFAULT 'pendiente' NOT NULL,
	"expires_at" text,
	"evidence_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_corrective_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"action_id" text,
	"responsible_user_id" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"closed_at" timestamp with time zone,
	"evidence_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_disseminations" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"kind" text NOT NULL,
	"worksite_id" text NOT NULL,
	"performed_by_user_id" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"attendance_url" text,
	"content_url" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"method" text DEFAULT 'arbol_causal' NOT NULL,
	"participants" jsonb NOT NULL,
	"root_causes" jsonb NOT NULL,
	"final_report_url" text,
	"status" text DEFAULT 'en_curso' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"kind" text NOT NULL,
	"recipient_role" text NOT NULL,
	"sent_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"channel" text DEFAULT 'email' NOT NULL,
	"evidence_url" text
);
--> statement-breakpoint
CREATE TABLE "incident_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"worker_id" text,
	"statement_type" text NOT NULL,
	"taken_by_user_id" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"file_url" text,
	"summary" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(15, 4) NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"period" text NOT NULL,
	"hours" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"file_url" text,
	"changelog" text,
	"signed_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"current_version_id" text,
	"mandatory" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minsal_protocols" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_framework" text NOT NULL,
	"applies_to_positions" jsonb NOT NULL,
	"periodicity_months" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "minsal_protocols_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "protocol_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"protocol_id" text NOT NULL,
	"started_at" text NOT NULL,
	"last_evaluation_at" text,
	"next_due_at" text,
	"status" text DEFAULT 'vigente' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "committee_agreements" ADD CONSTRAINT "committee_agreements_meeting_id_committee_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."committee_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_agreements" ADD CONSTRAINT "committee_agreements_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_meetings" ADD CONSTRAINT "committee_meetings_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committees" ADD CONSTRAINT "committees_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_workers" ADD CONSTRAINT "contractor_workers_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_workers" ADD CONSTRAINT "contractor_workers_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deliveries" ADD CONSTRAINT "document_deliveries_version_id_legal_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."legal_document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deliveries" ADD CONSTRAINT "document_deliveries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_delivery_id_document_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."document_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_drills" ADD CONSTRAINT "emergency_drills_plan_id_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."emergency_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_equipment" ADD CONSTRAINT "emergency_equipment_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_plans" ADD CONSTRAINT "emergency_plans_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_plans" ADD CONSTRAINT "emergency_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_teams" ADD CONSTRAINT "emergency_teams_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_teams" ADD CONSTRAINT "emergency_teams_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspections" ADD CONSTRAINT "equipment_inspections_equipment_id_emergency_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."emergency_equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_inspections" ADD CONSTRAINT "equipment_inspections_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_aptitudes" ADD CONSTRAINT "health_aptitudes_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_aptitudes" ADD CONSTRAINT "health_aptitudes_exam_id_health_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."health_exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_exams" ADD CONSTRAINT "health_exams_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_restrictions" ADD CONSTRAINT "health_restrictions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_corrective_followups" ADD CONSTRAINT "incident_corrective_followups_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_corrective_followups" ADD CONSTRAINT "incident_corrective_followups_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_disseminations" ADD CONSTRAINT "incident_disseminations_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_disseminations" ADD CONSTRAINT "incident_disseminations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_disseminations" ADD CONSTRAINT "incident_disseminations_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_investigations" ADD CONSTRAINT "incident_investigations_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_notifications" ADD CONSTRAINT "incident_notifications_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_notifications" ADD CONSTRAINT "incident_notifications_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_statements" ADD CONSTRAINT "incident_statements_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_statements" ADD CONSTRAINT "incident_statements_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_statements" ADD CONSTRAINT "incident_statements_taken_by_user_id_users_id_fk" FOREIGN KEY ("taken_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_hours" ADD CONSTRAINT "labor_hours_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_applications" ADD CONSTRAINT "protocol_applications_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_applications" ADD CONSTRAINT "protocol_applications_protocol_id_minsal_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."minsal_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_agreements_meeting_status_idx" ON "committee_agreements" USING btree ("meeting_id","status");--> statement-breakpoint
CREATE INDEX "committee_meetings_committee_scheduled_idx" ON "committee_meetings" USING btree ("committee_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_members_committee_user_unique" ON "committee_members" USING btree ("committee_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "committees_ws_type_unique" ON "committees" USING btree ("worksite_id","type");--> statement-breakpoint
CREATE INDEX "contractor_documents_contractor_type_expires_idx" ON "contractor_documents" USING btree ("contractor_id","type","expires_at");--> statement-breakpoint
CREATE INDEX "contractor_workers_contractor_end_idx" ON "contractor_workers" USING btree ("contractor_id","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "document_deliveries_version_worker_unique" ON "document_deliveries" USING btree ("version_id","worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_delivery_user_unique" ON "document_signatures" USING btree ("delivery_id","user_id");--> statement-breakpoint
CREATE INDEX "emergency_drills_plan_scheduled_idx" ON "emergency_drills" USING btree ("plan_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_equipment_ws_kind_code_unique" ON "emergency_equipment" USING btree ("worksite_id","kind","code");--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_plans_ws_version_unique" ON "emergency_plans" USING btree ("worksite_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_teams_ws_name_unique" ON "emergency_teams" USING btree ("worksite_id","name");--> statement-breakpoint
CREATE INDEX "equipment_inspections_equip_date_idx" ON "equipment_inspections" USING btree ("equipment_id","performed_at");--> statement-breakpoint
CREATE INDEX "health_aptitudes_worker_position_valid_idx" ON "health_aptitudes" USING btree ("worker_id","position","valid_until");--> statement-breakpoint
CREATE INDEX "health_exams_worker_type_expires_idx" ON "health_exams" USING btree ("worker_id","type","expires_at");--> statement-breakpoint
CREATE INDEX "health_restrictions_worker_to_idx" ON "health_restrictions" USING btree ("worker_id","effective_to");--> statement-breakpoint
CREATE INDEX "incident_corrective_followups_incident_status_idx" ON "incident_corrective_followups" USING btree ("incident_id","status");--> statement-breakpoint
CREATE INDEX "incident_corrective_followups_due_status_idx" ON "incident_corrective_followups" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "incident_disseminations_incident_performed_idx" ON "incident_disseminations" USING btree ("incident_id","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_investigations_incident_unique" ON "incident_investigations" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_notifications_incident_kind_role_unique" ON "incident_notifications" USING btree ("incident_id","kind","recipient_role");--> statement-breakpoint
CREATE INDEX "incident_notifications_deadline_sent_idx" ON "incident_notifications" USING btree ("deadline_at","sent_at");--> statement-breakpoint
CREATE INDEX "incident_statements_incident_taken_idx" ON "incident_statements" USING btree ("incident_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshots_ws_period_metric_unique" ON "kpi_snapshots" USING btree ("worksite_id","period","metric");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_period_idx" ON "kpi_snapshots" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "labor_hours_ws_period_unique" ON "labor_hours" USING btree ("worksite_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_document_versions_doc_version_unique" ON "legal_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_type_code_unique" ON "legal_documents" USING btree ("type","code");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_applications_worker_protocol_unique" ON "protocol_applications" USING btree ("worker_id","protocol_id");--> statement-breakpoint
CREATE INDEX "protocol_applications_due_idx" ON "protocol_applications" USING btree ("next_due_at","status");
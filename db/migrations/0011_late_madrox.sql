CREATE TABLE "alcohol_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"performed_by_user_id" text NOT NULL,
	"tested_worker_id" text,
	"shift" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"procedure_code" text DEFAULT 'DO-48' NOT NULL,
	"result" text DEFAULT 'negativo' NOT NULL,
	"evidence_url" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "behavioral_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"worker_id" text,
	"antecedent" text NOT NULL,
	"behavior" text NOT NULL,
	"consequence" text NOT NULL,
	"severity" text DEFAULT 'bajo' NOT NULL,
	"run_id" text,
	"corrective_action_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_lifecycle_policies" (
	"epp_product_id" text PRIMARY KEY NOT NULL,
	"lifespan_days" integer NOT NULL,
	"max_reuses" integer,
	"inspection_checklist" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_position_matrix" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"position" text NOT NULL,
	"epp_product_id" text NOT NULL,
	"risk_id" text,
	"required_since" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_recambio_log" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"epp_product_id" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"disposition" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_stock_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"epp_product_id" text NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"critical_stock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"kind" text NOT NULL,
	"asset_code" text NOT NULL,
	"performed_by_user_id" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"close_required" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_daily_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"equipment_id" text NOT NULL,
	"operator_worker_id" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"shift" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"odometer" integer,
	"hourmeter" integer,
	"checklist" jsonb NOT NULL,
	"signed_by_worker_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_report_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"reviewed_by_user_id" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'aprobado' NOT NULL,
	"findings" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"item_key" text NOT NULL,
	"expected" text NOT NULL,
	"observed" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"note" text,
	"photo_url" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"inspector_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"items" jsonb NOT NULL,
	"frequency" text DEFAULT 'mensual' NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inspection_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "permit_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"task" text NOT NULL,
	"location" text NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"ast" jsonb NOT NULL,
	"status" text DEFAULT 'solicitado' NOT NULL,
	"approver_id" text,
	"executor_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permit_signoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"role" text NOT NULL,
	"user_id" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permit_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"risk_type" text NOT NULL,
	"ast_fields" jsonb NOT NULL,
	"validity_hours" integer,
	"requires_signoff" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "permit_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sanitization_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"service_date" text NOT NULL,
	"report_url" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"expires_at" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_tested_worker_id_workers_id_fk" FOREIGN KEY ("tested_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_observations" ADD CONSTRAINT "behavioral_observations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_observations" ADD CONSTRAINT "behavioral_observations_observer_id_users_id_fk" FOREIGN KEY ("observer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_observations" ADD CONSTRAINT "behavioral_observations_run_id_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."inspection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_position_matrix" ADD CONSTRAINT "epp_position_matrix_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_recambio_log" ADD CONSTRAINT "epp_recambio_log_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_recambio_log" ADD CONSTRAINT "epp_recambio_log_epp_product_id_epp_lifecycle_policies_epp_product_id_fk" FOREIGN KEY ("epp_product_id") REFERENCES "public"."epp_lifecycle_policies"("epp_product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_stock_thresholds" ADD CONSTRAINT "epp_stock_thresholds_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checklists" ADD CONSTRAINT "equipment_checklists_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_checklists" ADD CONSTRAINT "equipment_checklists_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_daily_reports" ADD CONSTRAINT "equipment_daily_reports_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_daily_reports" ADD CONSTRAINT "equipment_daily_reports_operator_worker_id_workers_id_fk" FOREIGN KEY ("operator_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_daily_reports" ADD CONSTRAINT "equipment_daily_reports_signed_by_worker_id_workers_id_fk" FOREIGN KEY ("signed_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_report_reviews" ADD CONSTRAINT "equipment_report_reviews_report_id_equipment_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."equipment_daily_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_report_reviews" ADD CONSTRAINT "equipment_report_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_run_id_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."inspection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_runs" ADD CONSTRAINT "inspection_runs_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_runs" ADD CONSTRAINT "inspection_runs_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_runs" ADD CONSTRAINT "inspection_runs_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_attachments" ADD CONSTRAINT "permit_attachments_permit_id_permit_requests_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_attachments" ADD CONSTRAINT "permit_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requests" ADD CONSTRAINT "permit_requests_template_id_permit_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."permit_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requests" ADD CONSTRAINT "permit_requests_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requests" ADD CONSTRAINT "permit_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requests" ADD CONSTRAINT "permit_requests_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_requests" ADD CONSTRAINT "permit_requests_executor_id_users_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_signoffs" ADD CONSTRAINT "permit_signoffs_permit_id_permit_requests_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_signoffs" ADD CONSTRAINT "permit_signoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanitization_controls" ADD CONSTRAINT "sanitization_controls_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanitization_controls" ADD CONSTRAINT "sanitization_controls_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alcohol_tests_ws_date_idx" ON "alcohol_tests" USING btree ("worksite_id","performed_at");--> statement-breakpoint
CREATE INDEX "alcohol_tests_worker_date_idx" ON "alcohol_tests" USING btree ("tested_worker_id","performed_at");--> statement-breakpoint
CREATE INDEX "behavioral_observations_worksite_severity_idx" ON "behavioral_observations" USING btree ("worksite_id","severity");--> statement-breakpoint
CREATE INDEX "behavioral_observations_run_idx" ON "behavioral_observations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epp_position_matrix_ws_pos_prod_unique" ON "epp_position_matrix" USING btree ("worksite_id","position","epp_product_id");--> statement-breakpoint
CREATE INDEX "epp_recambio_log_worker_expires_idx" ON "epp_recambio_log" USING btree ("worker_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "epp_stock_thresholds_ws_prod_unique" ON "epp_stock_thresholds" USING btree ("worksite_id","epp_product_id");--> statement-breakpoint
CREATE INDEX "equipment_checklists_ws_kind_date_idx" ON "equipment_checklists" USING btree ("worksite_id","kind","performed_at");--> statement-breakpoint
CREATE INDEX "equipment_daily_reports_ws_date_idx" ON "equipment_daily_reports" USING btree ("worksite_id","reported_at");--> statement-breakpoint
CREATE INDEX "equipment_daily_reports_equip_date_idx" ON "equipment_daily_reports" USING btree ("equipment_id","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_report_reviews_report_unique" ON "equipment_report_reviews" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_items_run_key_unique" ON "inspection_items" USING btree ("run_id","item_key");--> statement-breakpoint
CREATE INDEX "inspection_items_status_idx" ON "inspection_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inspection_runs_worksite_status_idx" ON "inspection_runs" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "inspection_runs_inspector_idx" ON "inspection_runs" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "inspection_templates_frequency_idx" ON "inspection_templates" USING btree ("frequency");--> statement-breakpoint
CREATE INDEX "permit_attachments_permit_kind_idx" ON "permit_attachments" USING btree ("permit_id","kind");--> statement-breakpoint
CREATE INDEX "permit_requests_ws_status_planned_idx" ON "permit_requests" USING btree ("worksite_id","status","planned_start");--> statement-breakpoint
CREATE UNIQUE INDEX "permit_signoffs_permit_role_unique" ON "permit_signoffs" USING btree ("permit_id","role");--> statement-breakpoint
CREATE INDEX "permit_templates_risk_type_idx" ON "permit_templates" USING btree ("risk_type");--> statement-breakpoint
CREATE INDEX "sanitization_controls_ws_date_idx" ON "sanitization_controls" USING btree ("worksite_id","service_date");
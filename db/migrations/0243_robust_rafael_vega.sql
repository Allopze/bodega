CREATE TABLE "alcohol_test_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"sent_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"recipient" text NOT NULL,
	"evidence_url" text,
	"test_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alcohol_test_dispatches_month_valid" CHECK ("alcohol_test_dispatches"."month" BETWEEN 1 AND 12),
	CONSTRAINT "alcohol_test_dispatches_count_valid" CHECK ("alcohol_test_dispatches"."test_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "alcohol_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"performed_by_user_id" text NOT NULL,
	"tested_worker_id" text,
	"equipment_id" text,
	"shift" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"procedure_code" text DEFAULT 'DO-48' NOT NULL,
	"result" text DEFAULT 'negativo' NOT NULL,
	"evidence_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alcohol_tests_result_valid" CHECK ("alcohol_tests"."result" IN ('negativo', 'positivo'))
);
--> statement-breakpoint
ALTER TABLE "alcohol_test_dispatches" ADD CONSTRAINT "alcohol_test_dispatches_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_test_dispatches" ADD CONSTRAINT "alcohol_test_dispatches_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_tested_worker_id_workers_id_fk" FOREIGN KEY ("tested_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcohol_tests" ADD CONSTRAINT "alcohol_tests_equipment_id_service_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."service_equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alcohol_test_dispatches_worksite_period_unique" ON "alcohol_test_dispatches" USING btree ("worksite_id","year","month");--> statement-breakpoint
CREATE INDEX "alcohol_tests_worksite_performed_at_idx" ON "alcohol_tests" USING btree ("worksite_id","performed_at");
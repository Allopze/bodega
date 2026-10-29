CREATE TABLE "mant_record_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"work_type_id" text NOT NULL,
	"work_type_name" text NOT NULL,
	"hours" numeric(4, 1) NOT NULL,
	"no_parts" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mant_record_jobs_hours_valid" CHECK ("mant_record_jobs"."hours" >= 0.5 AND "mant_record_jobs"."hours" <= 72 AND ("mant_record_jobs"."hours" * 2) = floor("mant_record_jobs"."hours" * 2))
);
--> statement-breakpoint
ALTER TABLE "mant_record_correctives" ADD COLUMN "workshop_reason" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_jobs" ADD CONSTRAINT "mant_record_jobs_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_jobs" ADD CONSTRAINT "mant_record_jobs_work_type_id_mant_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."mant_work_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_record_jobs_record_idx" ON "mant_record_jobs" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_jobs_type_unique" ON "mant_record_jobs" USING btree ("record_id","work_type_id");--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_job_id_mant_record_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."mant_record_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_record_parts_job_idx" ON "mant_record_parts" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "mant_record_correctives" ADD CONSTRAINT "mant_record_correctives_workshop_reason_valid" CHECK (NOT "mant_record_correctives"."in_workshop" OR char_length(trim(coalesce("mant_record_correctives"."workshop_reason", ''))) >= 5);
DROP INDEX "pdtp_execution_checklists_execution_unique";--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD COLUMN "subject_type" text;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD COLUMN "subject_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD COLUMN "subject_label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_execution_checklists_execution_subject_unique" ON "pdtp_execution_checklists" USING btree ("execution_id","subject_id");
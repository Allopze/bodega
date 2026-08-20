CREATE TABLE "prevention_inspection_run_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"path" text NOT NULL,
	"kind" text DEFAULT 'source_form' NOT NULL,
	"caption" text,
	"extraction" jsonb,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_run_document_kind_valid" CHECK ("prevention_inspection_run_documents"."kind" IN ('source_form', 'attachment'))
);
--> statement-breakpoint
ALTER TABLE "prevention_inspection_answers" ADD COLUMN "needs_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD CONSTRAINT "prevention_inspection_run_documents_run_id_prevention_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prevention_inspection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD CONSTRAINT "prevention_inspection_run_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_inspection_run_document_run_idx" ON "prevention_inspection_run_documents" USING btree ("run_id","created_at");
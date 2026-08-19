CREATE TABLE "prevention_inspection_answer_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"path" text NOT NULL,
	"caption" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_inspection_answer_evidence" ADD CONSTRAINT "prevention_inspection_answer_evidence_answer_id_prevention_inspection_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."prevention_inspection_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_answer_evidence" ADD CONSTRAINT "prevention_inspection_answer_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_inspection_answer_evidence_answer_idx" ON "prevention_inspection_answer_evidence" USING btree ("answer_id");
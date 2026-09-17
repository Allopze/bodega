CREATE TABLE "pdtp_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_objectives_code_check" CHECK (length(trim("pdtp_objectives"."code")) > 0),
	CONSTRAINT "pdtp_objectives_name_check" CHECK (length(trim("pdtp_objectives"."name")) > 0),
	CONSTRAINT "pdtp_objectives_display_order_check" CHECK ("pdtp_objectives"."display_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "objective_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_objectives" ADD CONSTRAINT "pdtp_objectives_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_objectives_program_code_unique" ON "pdtp_objectives" USING btree ("program_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_objectives_program_id_unique" ON "pdtp_objectives" USING btree ("program_id","id");--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_objective_same_program_fk" FOREIGN KEY ("program_id","objective_id") REFERENCES "public"."pdtp_objectives"("program_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_activities_program_objective_idx" ON "pdtp_activities" USING btree ("program_id","objective_id");
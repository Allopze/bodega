CREATE TABLE "pdtp_program_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_program_id" text,
	"source_content_version" integer NOT NULL,
	"content_digest" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"published_by_user_id" text,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_program_template_versions_version_check" CHECK ("pdtp_program_template_versions"."version" >= 1),
	CONSTRAINT "pdtp_program_template_versions_digest_check" CHECK (length("pdtp_program_template_versions"."content_digest") = 64)
);
--> statement-breakpoint
CREATE TABLE "pdtp_program_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_program_templates_code_check" CHECK (length("pdtp_program_templates"."code") > 0),
	CONSTRAINT "pdtp_program_templates_name_check" CHECK (length("pdtp_program_templates"."name") > 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "source_template_version_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_program_template_versions" ADD CONSTRAINT "pdtp_program_template_versions_template_id_pdtp_program_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pdtp_program_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_template_versions" ADD CONSTRAINT "pdtp_program_template_versions_source_program_id_pdtp_programs_id_fk" FOREIGN KEY ("source_program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_template_versions" ADD CONSTRAINT "pdtp_program_template_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_templates" ADD CONSTRAINT "pdtp_program_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_program_template_versions_template_version_unique" ON "pdtp_program_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "pdtp_program_template_versions_published_idx" ON "pdtp_program_template_versions" USING btree ("template_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_program_templates_code_unique" ON "pdtp_program_templates" USING btree ("code");
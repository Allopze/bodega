CREATE TABLE "generated_document_archives" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"milestone" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"dedupe_key" text NOT NULL,
	"worksite_id" text,
	"worksite_label" text,
	"document_year" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_user_id" text,
	"render_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"late_render" boolean DEFAULT false NOT NULL,
	"file_name" text,
	"remote_key" text,
	"sha256" text,
	"size_bytes" integer,
	"staged_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"retried_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gen_doc_archives_status_valid" CHECK ("generated_document_archives"."status" IN ('pending', 'staged', 'uploaded', 'failed', 'superseded')),
	CONSTRAINT "gen_doc_archives_render_mode_valid" CHECK ("generated_document_archives"."render_mode" IN ('session', 'inprocess')),
	CONSTRAINT "gen_doc_archives_revision_positive" CHECK ("generated_document_archives"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gen_doc_archives_dedupe_key_uq" ON "generated_document_archives" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gen_doc_archives_remote_key_uq" ON "generated_document_archives" USING btree (lower("remote_key"));--> statement-breakpoint
CREATE INDEX "gen_doc_archives_status_next_idx" ON "generated_document_archives" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "gen_doc_archives_entity_idx" ON "generated_document_archives" USING btree ("kind","entity_id");
CREATE TABLE "sst_document_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"worksite_id" text,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sst_documents" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "sst_document_folders" ADD CONSTRAINT "sst_document_folders_parent_id_sst_document_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."sst_document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_folders" ADD CONSTRAINT "sst_document_folders_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_folders" ADD CONSTRAINT "sst_document_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_folders_parent_slug_unique" ON "sst_document_folders" USING btree ("parent_id","slug");--> statement-breakpoint
CREATE INDEX "sst_document_folders_parent_idx" ON "sst_document_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "sst_document_folders_worksite_idx" ON "sst_document_folders" USING btree ("worksite_id");--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_folder_id_sst_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."sst_document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sst_documents_folder_status_idx" ON "sst_documents" USING btree ("folder_id","status");
--> statement-breakpoint
INSERT INTO "sst_document_folders" (
	"id",
	"parent_id",
	"name",
	"slug",
	"worksite_id",
	"created_by",
	"archived_at",
	"created_at",
	"updated_at"
)
SELECT
	'sdf-cat-' || c."slug",
	NULL,
	c."name",
	c."slug",
	NULL,
	u."id",
	NULL,
	NOW(),
	NOW()
FROM "sst_document_categories" c
CROSS JOIN LATERAL (
	SELECT "id"
	FROM "users"
	ORDER BY "created_at" ASC
	LIMIT 1
) u
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "sst_documents" d
SET "folder_id" = 'sdf-cat-' || d."category_slug"
WHERE d."folder_id" IS NULL
  AND EXISTS (
	SELECT 1
	FROM "sst_document_folders" f
	WHERE f."id" = 'sdf-cat-' || d."category_slug"
  );

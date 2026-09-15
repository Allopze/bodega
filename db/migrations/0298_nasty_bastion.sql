ALTER TABLE "pdtp_catalog_activity_revisions" DROP CONSTRAINT IF EXISTS "pdtp_catalog_activity_revisions_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_catalog_activity_revisions" ADD CONSTRAINT "pdtp_catalog_activity_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

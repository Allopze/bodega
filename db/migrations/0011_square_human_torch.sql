ALTER TABLE "worksite_users" ADD CONSTRAINT "worksite_users_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;

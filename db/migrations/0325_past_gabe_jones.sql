CREATE TABLE "pdtp_program_acknowledgments" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdtp_program_acknowledgments" ADD CONSTRAINT "pdtp_program_acknowledgments_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_acknowledgments" ADD CONSTRAINT "pdtp_program_acknowledgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_program_acknowledgments_program_user_unique" ON "pdtp_program_acknowledgments" USING btree ("program_id","user_id");
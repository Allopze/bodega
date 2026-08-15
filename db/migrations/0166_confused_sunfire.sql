CREATE TABLE "prevention_committee_commission_members" (
	"id" text PRIMARY KEY NOT NULL,
	"commission_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_commission_name_valid" CHECK (length("prevention_committee_commissions"."name") >= 3),
	CONSTRAINT "prevention_committee_commission_purpose_valid" CHECK (length("prevention_committee_commissions"."purpose") >= 10)
);
--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD COLUMN "guest_worker_id" text;--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD COLUMN "agenda_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD COLUMN "sent_to_management_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_committee_commission_members" ADD CONSTRAINT "prevention_committee_commission_members_commission_id_prevention_committee_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."prevention_committee_commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_commission_members" ADD CONSTRAINT "prevention_committee_commission_members_member_id_prevention_committee_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."prevention_committee_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_commissions" ADD CONSTRAINT "prevention_committee_commissions_committee_id_prevention_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_commissions" ADD CONSTRAINT "prevention_committee_commissions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_commission_member_unique" ON "prevention_committee_commission_members" USING btree ("commission_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_commission_unique" ON "prevention_committee_commissions" USING btree ("committee_id","name") WHERE "prevention_committee_commissions"."is_active";--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD CONSTRAINT "prevention_committee_attendance_guest_worker_id_workers_id_fk" FOREIGN KEY ("guest_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD CONSTRAINT "prevention_committee_attendance_subject_valid" CHECK (("prevention_committee_attendance"."member_id" IS NOT NULL AND "prevention_committee_attendance"."guest_worker_id" IS NULL AND "prevention_committee_attendance"."guest_name" IS NULL) OR ("prevention_committee_attendance"."member_id" IS NULL AND ("prevention_committee_attendance"."guest_worker_id" IS NOT NULL OR length("prevention_committee_attendance"."guest_name") >= 3)));
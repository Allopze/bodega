CREATE TABLE "contract_vehicle_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_to" text,
	"reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_vehicle_assignments_dates_valid" CHECK ("contract_vehicle_assignments"."valid_to" IS NULL OR "contract_vehicle_assignments"."valid_to" >= "contract_vehicle_assignments"."valid_from"),
	CONSTRAINT "contract_vehicle_assignments_from_format" CHECK ("contract_vehicle_assignments"."valid_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "contract_vehicle_assignments_to_format" CHECK ("contract_vehicle_assignments"."valid_to" IS NULL OR "contract_vehicle_assignments"."valid_to" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "contract_vehicle_assignments_reason_length" CHECK ("contract_vehicle_assignments"."reason" IS NULL OR length("contract_vehicle_assignments"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "contracts_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "contract_vehicle_assignments" ADD CONSTRAINT "contract_vehicle_assignments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_vehicle_assignments" ADD CONSTRAINT "contract_vehicle_assignments_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_vehicle_assignments" ADD CONSTRAINT "contract_vehicle_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_vehicle_assignments_open_unique" ON "contract_vehicle_assignments" USING btree ("vehicle_id") WHERE "contract_vehicle_assignments"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "contract_vehicle_assignments_vehicle_from_idx" ON "contract_vehicle_assignments" USING btree ("vehicle_id","valid_from");--> statement-breakpoint
CREATE INDEX "contract_vehicle_assignments_contract_from_idx" ON "contract_vehicle_assignments" USING btree ("contract_id","valid_from");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;
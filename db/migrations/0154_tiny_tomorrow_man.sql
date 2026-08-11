CREATE TABLE "dte_portal_operation_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dte_portal_operation_leases_expiry_idx" ON "dte_portal_operation_leases" USING btree ("lease_expires_at");
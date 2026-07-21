CREATE TABLE "prevention_privacy_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"format" text DEFAULT 'xlsx' NOT NULL,
	"includes_clinical" boolean DEFAULT false NOT NULL,
	"health_record_count" text DEFAULT '0' NOT NULL,
	"checksum_sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"delivered_by_user_id" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_privacy_delivery_format_valid" CHECK ("prevention_privacy_deliveries"."format" = 'xlsx'),
	CONSTRAINT "prevention_privacy_delivery_checksum_valid" CHECK (length("prevention_privacy_deliveries"."checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_privacy_request_history" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_privacy_request_history_from_valid" CHECK ("prevention_privacy_request_history"."from_status" IS NULL OR "prevention_privacy_request_history"."from_status" IN ('recibida', 'validando_identidad', 'en_proceso', 'suspendida_retencion', 'completada', 'rechazada')),
	CONSTRAINT "prevention_privacy_request_history_to_valid" CHECK ("prevention_privacy_request_history"."to_status" IN ('recibida', 'validando_identidad', 'en_proceso', 'suspendida_retencion', 'completada', 'rechazada'))
);
--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD COLUMN "identity_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD COLUMN "identity_verified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "prevention_privacy_deliveries" ADD CONSTRAINT "prevention_privacy_deliveries_request_id_prevention_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."prevention_privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_deliveries" ADD CONSTRAINT "prevention_privacy_deliveries_delivered_by_user_id_users_id_fk" FOREIGN KEY ("delivered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_request_history" ADD CONSTRAINT "prevention_privacy_request_history_request_id_prevention_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."prevention_privacy_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_request_history" ADD CONSTRAINT "prevention_privacy_request_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_privacy_delivery_request_idx" ON "prevention_privacy_deliveries" USING btree ("request_id","delivered_at");--> statement-breakpoint
CREATE INDEX "prevention_privacy_request_history_idx" ON "prevention_privacy_request_history" USING btree ("request_id","created_at");--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD CONSTRAINT "prevention_privacy_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD CONSTRAINT "prevention_privacy_requests_identity_verified_by_user_id_users_id_fk" FOREIGN KEY ("identity_verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
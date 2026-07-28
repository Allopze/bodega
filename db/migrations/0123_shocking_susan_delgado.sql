CREATE TABLE "epp_replenishment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"epp_type_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"gap_version" text NOT NULL,
	"request_item_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "epp_replenishment_links" ADD CONSTRAINT "epp_replenishment_links_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_replenishment_links" ADD CONSTRAINT "epp_replenishment_links_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_replenishment_links" ADD CONSTRAINT "epp_replenishment_links_epp_type_id_epp_types_id_fk" FOREIGN KEY ("epp_type_id") REFERENCES "public"."epp_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_replenishment_links" ADD CONSTRAINT "epp_replenishment_links_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epp_replenishment_links_open_gap_unique" ON "epp_replenishment_links" USING btree ("worksite_id","worker_id","epp_type_id","requirement_id","gap_version") WHERE "epp_replenishment_links"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "epp_replenishment_links_request_item_idx" ON "epp_replenishment_links" USING btree ("request_item_id");
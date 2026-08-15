CREATE TABLE "prevention_risk_map_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"title" text NOT NULL,
	"image_path" text NOT NULL,
	"image_mime_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_map_layout_status_valid" CHECK ("prevention_risk_map_layouts"."status" IN ('active', 'archived')),
	CONSTRAINT "prevention_risk_map_layout_version_positive" CHECK ("prevention_risk_map_layouts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_map_markers" (
	"id" text PRIMARY KEY NOT NULL,
	"layout_id" text NOT NULL,
	"risk_entry_id" text NOT NULL,
	"x_pct" numeric(5, 2) NOT NULL,
	"y_pct" numeric(5, 2) NOT NULL,
	"label" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_map_marker_x_valid" CHECK ("prevention_risk_map_markers"."x_pct" BETWEEN 0 AND 100),
	CONSTRAINT "prevention_risk_map_marker_y_valid" CHECK ("prevention_risk_map_markers"."y_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "prevention_risk_map_layouts" ADD CONSTRAINT "prevention_risk_map_layouts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_map_layouts" ADD CONSTRAINT "prevention_risk_map_layouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_map_markers" ADD CONSTRAINT "prevention_risk_map_markers_layout_id_prevention_risk_map_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."prevention_risk_map_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_map_markers" ADD CONSTRAINT "prevention_risk_map_markers_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_map_markers" ADD CONSTRAINT "prevention_risk_map_markers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_map_layout_active_unique" ON "prevention_risk_map_layouts" USING btree ("worksite_id") WHERE "prevention_risk_map_layouts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "prevention_risk_map_marker_layout_idx" ON "prevention_risk_map_markers" USING btree ("layout_id");
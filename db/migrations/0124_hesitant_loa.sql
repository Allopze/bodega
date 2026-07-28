CREATE TABLE "stock_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" real NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_adjustments_quantity_nonzero" CHECK ("stock_adjustments"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" real NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_returns_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_returns_quantity_positive" CHECK ("stock_returns"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustments_worksite_created_at_idx" ON "stock_adjustments" USING btree ("worksite_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_returns_worksite_created_at_idx" ON "stock_returns" USING btree ("worksite_id","created_at");
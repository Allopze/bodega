CREATE TABLE "safety_indicators" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"trabajadores" integer DEFAULT 0 NOT NULL,
	"horas_hombre" numeric(12, 2) DEFAULT 0 NOT NULL,
	"acc_con_tiempo_perdido" integer DEFAULT 0 NOT NULL,
	"acc_sin_tiempo_perdido" integer DEFAULT 0 NOT NULL,
	"dias_perdidos" integer DEFAULT 0 NOT NULL,
	"incidentes" integer DEFAULT 0 NOT NULL,
	"dano_material" integer DEFAULT 0 NOT NULL,
	"dano_ambiental" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_indicators_month_check" CHECK ("safety_indicators"."month" BETWEEN 1 AND 12),
	CONSTRAINT "safety_indicators_year_check" CHECK ("safety_indicators"."year" BETWEEN 2024 AND 2100),
	CONSTRAINT "safety_indicators_trabajadores_check" CHECK ("safety_indicators"."trabajadores" >= 0),
	CONSTRAINT "safety_indicators_horas_hombre_check" CHECK ("safety_indicators"."horas_hombre" >= 0),
	CONSTRAINT "safety_indicators_acc_ctp_check" CHECK ("safety_indicators"."acc_con_tiempo_perdido" >= 0),
	CONSTRAINT "safety_indicators_acc_stp_check" CHECK ("safety_indicators"."acc_sin_tiempo_perdido" >= 0),
	CONSTRAINT "safety_indicators_dias_perdidos_check" CHECK ("safety_indicators"."dias_perdidos" >= 0),
	CONSTRAINT "safety_indicators_incidentes_check" CHECK ("safety_indicators"."incidentes" >= 0),
	CONSTRAINT "safety_indicators_dano_material_check" CHECK ("safety_indicators"."dano_material" >= 0),
	CONSTRAINT "safety_indicators_dano_ambiental_check" CHECK ("safety_indicators"."dano_ambiental" >= 0)
);
--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD CONSTRAINT "safety_indicators_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD CONSTRAINT "safety_indicators_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_indicators_worksite_period_unique" ON "safety_indicators" USING btree ("worksite_id","year","month");--> statement-breakpoint
CREATE INDEX "safety_indicators_worksite_year_idx" ON "safety_indicators" USING btree ("worksite_id","year");
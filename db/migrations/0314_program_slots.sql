-- Casillas del programa para simulacros y actas del CGRD (2026-09-19).
--
-- Lo que el PDTP espera, por faena y año: dos simulacros (N°84, marzo y
-- septiembre) y cuatro sesiones del comité GRD (N°81, meses 2 a 5). Se
-- pre-generan al activar la faena, igual que las ocurrencias de capacitación.
--
-- Sin una fila que exista antes de que pase nada, "no se hizo" es
-- indistinguible de "nadie lo cargó": ése era el estado de los dos módulos.
--
-- La casilla no es el hecho. `drill_id` y `meeting_id` apuntan al registro que
-- la cumplió y son nullable, porque una casilla puede quedar sin hacerse o
-- declararse no aplicable; y a la inversa, un simulacro o una sesión
-- extraordinaria existen sin casilla y no cuentan en el denominador.
CREATE TABLE "prevention_emergency_drill_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_month" integer NOT NULL,
	"scheduled_week" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"drill_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"not_applicable_at" timestamp with time zone,
	"not_applicable_by_user_id" text,
	"not_applicable_reason" text,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_drill_slot_year_check" CHECK ("prevention_emergency_drill_slots"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_emergency_drill_slot_status_check" CHECK ("prevention_emergency_drill_slots"."status" IN ('pending', 'completed', 'not_completed', 'not_applicable')),
	CONSTRAINT "prevention_emergency_drill_slot_period_check" CHECK ("prevention_emergency_drill_slots"."scheduled_month" BETWEEN 1 AND 12 AND "prevention_emergency_drill_slots"."scheduled_week" BETWEEN 1 AND 4),
	CONSTRAINT "prevention_emergency_drill_slot_done_check" CHECK (("prevention_emergency_drill_slots"."status" = 'completed' AND "prevention_emergency_drill_slots"."drill_id" IS NOT NULL AND "prevention_emergency_drill_slots"."completed_at" IS NOT NULL AND "prevention_emergency_drill_slots"."completed_by_user_id" IS NOT NULL) OR ("prevention_emergency_drill_slots"."status" <> 'completed' AND "prevention_emergency_drill_slots"."completed_at" IS NULL AND "prevention_emergency_drill_slots"."completed_by_user_id" IS NULL)),
	CONSTRAINT "prevention_emergency_drill_slot_na_check" CHECK (("prevention_emergency_drill_slots"."status" = 'not_applicable' AND "prevention_emergency_drill_slots"."not_applicable_at" IS NOT NULL AND "prevention_emergency_drill_slots"."not_applicable_by_user_id" IS NOT NULL AND length(trim(COALESCE("prevention_emergency_drill_slots"."not_applicable_reason", ''))) >= 10) OR ("prevention_emergency_drill_slots"."status" <> 'not_applicable' AND "prevention_emergency_drill_slots"."not_applicable_at" IS NULL AND "prevention_emergency_drill_slots"."not_applicable_by_user_id" IS NULL AND "prevention_emergency_drill_slots"."not_applicable_reason" IS NULL)),
	CONSTRAINT "prevention_emergency_drill_slot_version_check" CHECK ("prevention_emergency_drill_slots"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_grd_meeting_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_month" integer NOT NULL,
	"scheduled_week" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"meeting_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"not_applicable_at" timestamp with time zone,
	"not_applicable_by_user_id" text,
	"not_applicable_reason" text,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_meeting_slot_year_check" CHECK ("prevention_grd_meeting_slots"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_grd_meeting_slot_status_check" CHECK ("prevention_grd_meeting_slots"."status" IN ('pending', 'completed', 'not_completed', 'not_applicable')),
	CONSTRAINT "prevention_grd_meeting_slot_period_check" CHECK ("prevention_grd_meeting_slots"."scheduled_month" BETWEEN 1 AND 12 AND "prevention_grd_meeting_slots"."scheduled_week" BETWEEN 1 AND 4),
	CONSTRAINT "prevention_grd_meeting_slot_done_check" CHECK (("prevention_grd_meeting_slots"."status" = 'completed' AND "prevention_grd_meeting_slots"."meeting_id" IS NOT NULL AND "prevention_grd_meeting_slots"."completed_at" IS NOT NULL AND "prevention_grd_meeting_slots"."completed_by_user_id" IS NOT NULL) OR ("prevention_grd_meeting_slots"."status" <> 'completed' AND "prevention_grd_meeting_slots"."completed_at" IS NULL AND "prevention_grd_meeting_slots"."completed_by_user_id" IS NULL)),
	CONSTRAINT "prevention_grd_meeting_slot_na_check" CHECK (("prevention_grd_meeting_slots"."status" = 'not_applicable' AND "prevention_grd_meeting_slots"."not_applicable_at" IS NOT NULL AND "prevention_grd_meeting_slots"."not_applicable_by_user_id" IS NOT NULL AND length(trim(COALESCE("prevention_grd_meeting_slots"."not_applicable_reason", ''))) >= 10) OR ("prevention_grd_meeting_slots"."status" <> 'not_applicable' AND "prevention_grd_meeting_slots"."not_applicable_at" IS NULL AND "prevention_grd_meeting_slots"."not_applicable_by_user_id" IS NULL AND "prevention_grd_meeting_slots"."not_applicable_reason" IS NULL)),
	CONSTRAINT "prevention_grd_meeting_slot_version_check" CHECK ("prevention_grd_meeting_slots"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_slots" ADD CONSTRAINT "drill_slot_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_slots" ADD CONSTRAINT "drill_slot_drill_fk" FOREIGN KEY ("drill_id") REFERENCES "public"."prevention_emergency_drills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_slots" ADD CONSTRAINT "drill_slot_completer_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_slots" ADD CONSTRAINT "drill_slot_na_actor_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "prevention_grd_meeting_slots_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "prevention_grd_meeting_slots_meeting_id_prevention_grd_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_grd_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "prevention_grd_meeting_slots_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "prevention_grd_meeting_slots_not_applicable_by_user_id_users_id_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_drill_slot_unique" ON "prevention_emergency_drill_slots" USING btree ("worksite_id","year","slot_key");--> statement-breakpoint
CREATE INDEX "prevention_emergency_drill_slot_period_idx" ON "prevention_emergency_drill_slots" USING btree ("worksite_id","year","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_meeting_slot_unique" ON "prevention_grd_meeting_slots" USING btree ("worksite_id","year","slot_key");--> statement-breakpoint
CREATE INDEX "prevention_grd_meeting_slot_period_idx" ON "prevention_grd_meeting_slots" USING btree ("worksite_id","year","status");
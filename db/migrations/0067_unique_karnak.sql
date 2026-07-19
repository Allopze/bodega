CREATE TABLE "ppa_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"ppa_id" text NOT NULL,
	"capa_action_id" text,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ppa_status_history_from_check" CHECK ("ppa_status_history"."from_status" IS NULL OR "ppa_status_history"."from_status" IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado')),
	CONSTRAINT "ppa_status_history_to_check" CHECK ("ppa_status_history"."to_status" IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado'))
);
--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "correction_declared_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "correction_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "verified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "verification_comment" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "authorized_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "closed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "close_comment" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ppa_status_history" ADD CONSTRAINT "ppa_status_history_ppa_id_ppa_submissions_id_fk" FOREIGN KEY ("ppa_id") REFERENCES "public"."ppa_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_status_history" ADD CONSTRAINT "ppa_status_history_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_status_history" ADD CONSTRAINT "ppa_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ppa_status_history_ppa_created_idx" ON "ppa_status_history" USING btree ("ppa_id","created_at");--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_correction_declared_by_user_id_users_id_fk" FOREIGN KEY ("correction_declared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_estado_check" CHECK ("ppa_submissions"."estado" IN ('aprobado_auto', 'detenido', 'en_correccion', 'pendiente_verificacion', 'autorizado', 'rechazado', 'cancelado', 'cerrado'));--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_version_check" CHECK ("ppa_submissions"."version" >= 1);--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_cancel_check" CHECK (("ppa_submissions"."cancelled_at" IS NULL AND "ppa_submissions"."cancelled_by_user_id" IS NULL AND "ppa_submissions"."cancellation_reason" IS NULL) OR ("ppa_submissions"."cancelled_at" IS NOT NULL AND "ppa_submissions"."cancelled_by_user_id" IS NOT NULL AND length("ppa_submissions"."cancellation_reason") >= 5));
--> statement-breakpoint
-- Historial inicial conservador: sólo usa actores y fechas que ya existían en
-- el PPA. No infiere verificadores, autorizadores ni cierres históricos.
INSERT INTO ppa_status_history (
  id, ppa_id, capa_action_id, from_status, to_status, reason, actor_user_id, created_at
)
SELECT
  'ppah-backfill-initial-' || s.id,
  s.id,
  a.capa_action_id,
  NULL,
  s.estado,
  'Estado histórico incorporado al workflow PPA; requiere conciliación de actores y evidencia',
  s.reviewed_by,
  COALESCE(s.reviewed_at, s.updated_at, s.created_at)
FROM ppa_submissions s
LEFT JOIN ppa_corrective_actions a ON a.ppa_id = s.id
WHERE s.reviewed_by IS NOT NULL
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Contención histórica: una autorización o cierre legado sin CAPA verificada
-- no se conserva como habilitación operativa. La reapertura queda trazada con
-- el actor disponible en la fuente; las filas sin actor se dejan para revisión
-- explícita en el inventario de conciliación, sin inventar identidades.
INSERT INTO ppa_status_history (
  id, ppa_id, capa_action_id, from_status, to_status, reason, actor_user_id, created_at
)
SELECT
  'ppah-backfill-reopen-' || s.id,
  s.id,
  a.capa_action_id,
  s.estado,
  'en_correccion',
  'Reapertura administrativa: la autorización/cierre legado no tiene CAPA verificada',
  COALESCE(a.created_by, s.reviewed_by),
  CURRENT_TIMESTAMP
FROM ppa_submissions s
LEFT JOIN ppa_corrective_actions a ON a.ppa_id = s.id
LEFT JOIN prevention_capa_actions capa ON capa.id = a.capa_action_id
WHERE s.estado IN ('autorizado', 'cerrado')
  AND (capa.id IS NULL OR capa.status NOT IN ('verified', 'closed'))
  AND COALESCE(a.created_by, s.reviewed_by) IS NOT NULL
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
UPDATE ppa_submissions s
SET
  estado = 'en_correccion',
  authorized_by_user_id = NULL,
  authorized_at = NULL,
  closed_by_user_id = NULL,
  closed_at = NULL,
  close_comment = NULL,
  version = s.version + 1,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    source.id,
    COALESCE(a.created_by, source.reviewed_by) AS actor_user_id
  FROM ppa_submissions source
  LEFT JOIN ppa_corrective_actions a ON a.ppa_id = source.id
  LEFT JOIN prevention_capa_actions capa ON capa.id = a.capa_action_id
  WHERE source.estado IN ('autorizado', 'cerrado')
    AND (capa.id IS NULL OR capa.status NOT IN ('verified', 'closed'))
) invalid
WHERE s.id = invalid.id
  AND invalid.actor_user_id IS NOT NULL;

-- Corrige los FK de las casillas del programa (2026-09-19).
--
-- Dos cosas, ambas descubiertas por los CHECK que 0314 introdujo:
--
-- 1. `ON DELETE set null` dejaba la casilla en `completed` apuntando a nada, y
--    el CHECK que impide una casilla en verde sin hecho rechazaba el borrado
--    con un error de driver. Pasan a `restrict`: un simulacro o un acta que
--    llena una casilla no se borra, se cancela o se anula, y eso la libera.
--
-- 2. Dos nombres autogenerados superaban los 63 bytes que Postgres admite para
--    un identificador. Truncados en silencio, el constraint real queda con otro
--    nombre y un `DROP ... IF EXISTS` futuro no lo encuentra.
ALTER TABLE "prevention_emergency_drill_slots" DROP CONSTRAINT IF EXISTS "drill_slot_drill_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_slots_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_slots_meeting_id_prevention_grd_meetings_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_slots_completed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_slots_not_applicable_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_slots" ADD CONSTRAINT "drill_slot_drill_fk" FOREIGN KEY ("drill_id") REFERENCES "public"."prevention_emergency_drills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "grd_slot_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "grd_slot_meeting_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_grd_meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "grd_slot_completer_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meeting_slots" ADD CONSTRAINT "grd_slot_na_actor_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
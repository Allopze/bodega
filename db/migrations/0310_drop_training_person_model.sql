-- Retira el modelo de capacitación por persona (2026-09-19).
--
-- El cumplimiento de capacitación se mide por actividad realizada y su
-- evidencia —`prevention_training_occurrences`—, no por competencia individual
-- vigente. Las seis tablas de abajo sostenían el modelo anterior: cursos con
-- ciclo de versiones, sesiones, asistencia con acuse firmado, competencias por
-- trabajador y sus requisitos.
--
-- `prevention_training_history` NO se dropea: es la bitácora de cambios de
-- estado de una ocurrencia y la escribe el modelo que sobrevive.
--
-- `IF EXISTS` en todas: una migración que dropea algo ya ausente aborta el
-- deploy entero y no se puede re-aplicar.
DROP TABLE IF EXISTS "prevention_competency_requirements" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_training_attendance" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_training_course_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_training_courses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_training_sessions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_worker_competencies" CASCADE;--> statement-breakpoint
-- Enlazaba el tipo de permiso con los requisitos de competencia de alcance
-- `task` para bloquear la activación de un permiso cuya cuadrilla no estuviera
-- habilitada. Sin competencias no queda nadie que la lea.
ALTER TABLE "prevention_permit_types" DROP COLUMN IF EXISTS "competency_task_key";

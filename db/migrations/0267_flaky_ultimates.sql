-- Agrega `teorica` a las modalidades de capacitación.
--
-- El enum mezclaba canal de entrega (presencial, elearning, mixta) con forma
-- pedagógica (practica), y faltaba el par de esta última. Las fichas de los
-- organismos administradores describen sus cursos como "teórica" o
-- "teórico-práctica" —no por el canal—, así que una ficha expositiva había que
-- forzarla a `presencial` o `elearning`, que dice dónde se dictó y no cómo.
--
-- Sólo ensancha el conjunto permitido: toda fila existente sigue cumpliendo el
-- constraint nuevo, así que no hay dato que migrar.

ALTER TABLE "prevention_training_course_versions" DROP CONSTRAINT "prevention_training_version_modality_valid";--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" DROP CONSTRAINT "prevention_training_session_modality_valid";--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_version_modality_valid" CHECK ("prevention_training_course_versions"."modality" IN ('presencial', 'elearning', 'mixta', 'practica', 'teorica'));--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_session_modality_valid" CHECK ("prevention_training_sessions"."modality" IN ('presencial', 'elearning', 'mixta', 'practica', 'teorica'));
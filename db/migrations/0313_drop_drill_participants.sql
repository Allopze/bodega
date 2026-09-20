-- Retira la asistencia nominal a simulacros (2026-09-19).
--
-- Se escribía en cada cierre y ninguna consulta la leía nunca: el único dato
-- que sobrevivía era el largo del array, usado como `executedQuantity` de la
-- acreditación, lo que hacía que un simulacro con 30 asistentes acreditara
-- cantidad 30 contra una cantidad planificada de 1.
--
-- Lo que respaldaba el hecho pasa a ser el acta (`prevention_emergency_drill_evidence`).
DROP TABLE IF EXISTS "prevention_emergency_drill_participants" CASCADE;

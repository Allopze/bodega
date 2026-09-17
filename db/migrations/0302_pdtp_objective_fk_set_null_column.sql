-- Custom SQL migration file, put your code below! --

-- I3 (QA 2026-09-16, ronda de arreglos 1/5 de la tarea 1.2): la FK compuesta
-- creada en 0301 declaraba `ON DELETE SET NULL` sin lista de columnas, y
-- Postgres nulifica TODAS las columnas de una FK compuesta en ese modo —
-- incluida "program_id", que es NOT NULL. Borrar un objetivo referenciado (o
-- un programa completo, cuyo cascade también pasa por aquí) revienta con
-- 23502 en cualquier orden de ejecución donde el cascade de
-- "pdtp_activities" no se haya disparado todavía. Redeclarar con la sintaxis
-- de columna específica (PG15+, este proyecto usa Postgres 16) para que sólo
-- "objective_id" se ponga en NULL y "program_id" quede intacto.
ALTER TABLE "pdtp_activities" DROP CONSTRAINT IF EXISTS "pdtp_activities_objective_same_program_fk";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_objective_same_program_fk" FOREIGN KEY ("program_id","objective_id") REFERENCES "public"."pdtp_objectives"("program_id","id") ON DELETE SET NULL ("objective_id") ON UPDATE no action;

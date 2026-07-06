ALTER TABLE "pdtp_sheets" DROP CONSTRAINT "pdtp_sheets_program_id_pdtp_programs_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_sheets" ADD CONSTRAINT "pdtp_sheets_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_year_check" CHECK ("pdtp_programs"."year" BETWEEN 2024 AND 2100);
--> statement-breakpoint
-- pdtp_sheets_label_unique fue creado en 0008_outgoing_paladin.sql pero
-- 0024_strong_polaris.sql (swap de PK code->id) dejó de rastrearlo en su
-- snapshot sin emitir el DROP correspondiente: drizzle-kit ya no lo ve
-- (por eso `db:generate` no lo generó acá), pero puede seguir existiendo
-- físicamente en bases donde 0024 corrió tal cual quedó escrito. Bloquea
-- que dos programas tengan una hoja con el mismo label (todas copian los
-- mismos labels de SHEET_META) — lo real es pdtp_sheets_program_code_unique.
-- IF EXISTS lo vuelve idempotente sin importar el estado real de cada base.
DROP INDEX IF EXISTS "pdtp_sheets_label_unique";
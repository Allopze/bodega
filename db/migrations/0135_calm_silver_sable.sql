ALTER TABLE "pdtp_action_plan" ADD COLUMN "dano_potencial" text;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD COLUMN "normativa_legal" text;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_dano_potencial_check" CHECK ("pdtp_action_plan"."dano_potencial" IS NULL OR "pdtp_action_plan"."dano_potencial" IN ('leve', 'moderado', 'grave', 'fatal'));
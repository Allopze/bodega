ALTER TABLE "pdtp_activities" DROP CONSTRAINT "pdtp_activities_subject_source_check";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "subject_capability_codes" text[];--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_subject_capabilities_check" CHECK ((
    "pdtp_activities"."subject_source" = 'trabajadores_capacidad'
    AND COALESCE(cardinality("pdtp_activities"."subject_capability_codes"), 0) > 0
  ) OR (
    "pdtp_activities"."subject_source" IS DISTINCT FROM 'trabajadores_capacidad'
    AND "pdtp_activities"."subject_capability_codes" IS NULL
  ));--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_subject_source_check" CHECK ("pdtp_activities"."subject_source" IS NULL OR "pdtp_activities"."subject_source" IN ('dotacion', 'extintores', 'expuestos_ges', 'equipos', 'trabajadores_nuevos', 'trabajadores_capacidad'));
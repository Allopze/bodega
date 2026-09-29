-- M-06 (auditoría de production readiness 2026-09-28): la reducción de una meta
-- por faena pasa por la misma revisión de dos personas que la cancelación de
-- una obligación; `payload_json` guarda la celda y la cantidad pedida.
ALTER TABLE "pdtp_review_requests" DROP CONSTRAINT IF EXISTS "pdtp_review_requests_kind_check";--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD COLUMN "payload_json" jsonb;--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_kind_check" CHECK ("pdtp_review_requests"."kind" IN ('obligation_cancellation', 'execution_annulment', 'override_reduction'));
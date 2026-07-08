ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_type_urgency_status_valid";--> statement-breakpoint
-- B-5: 'stock' y 'mantencion' ya no son tipos de solicitud válidos (la UI usa
-- epp/otro/repuestos/servicios). Remap defensivo e idempotente de cualquier fila
-- legacy a 'otro' antes de re-crear el check, para que la migración no falle en
-- entornos que aún tengan esos valores.
UPDATE "purchase_requests" SET "request_type" = 'otro' WHERE "request_type" IN ('stock', 'mantencion');--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_type_urgency_status_valid" CHECK (
    "purchase_requests"."request_type" IN ('epp', 'otro', 'repuestos', 'servicios')
    AND "purchase_requests"."urgency" IN ('normal', 'high', 'critical')
    AND "purchase_requests"."status" IN (
      'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
      'rejected', 'returned', 'in_purchasing', 'closed', 'cancelled'
    )
  );

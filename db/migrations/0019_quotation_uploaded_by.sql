ALTER TABLE "repuesto_quotations"
  ADD COLUMN IF NOT EXISTS "uploaded_by" text REFERENCES "users"("id");

ALTER TABLE "service_quotations"
  ADD COLUMN IF NOT EXISTS "uploaded_by" text REFERENCES "users"("id");

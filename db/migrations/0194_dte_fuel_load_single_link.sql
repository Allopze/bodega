CREATE UNIQUE INDEX "dte_documents_fuel_load_single_unique" ON "dte_documents" USING btree ("fuel_load_id") WHERE "dte_documents"."fuel_load_id" IS NOT NULL;

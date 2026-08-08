CREATE UNIQUE INDEX "repuesto_quotations_one_selected" ON "repuesto_quotations" USING btree ("request_id") WHERE "repuesto_quotations"."status" = 'selected';--> statement-breakpoint
CREATE UNIQUE INDEX "service_quotations_one_selected" ON "service_quotations" USING btree ("request_id") WHERE "service_quotations"."status" = 'selected';

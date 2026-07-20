-- Deduplicate before adding unique constraint: keep highest id per (request_item_id, attribute_name).
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT request_item_id, attribute_name, count(*) AS cnt
    FROM request_item_attributes
    GROUP BY request_item_id, attribute_name
    HAVING count(*) > 1
  LOOP
    DELETE FROM request_item_attributes
    WHERE id IN (
      SELECT id FROM request_item_attributes
      WHERE request_item_id = dup.request_item_id
        AND attribute_name = dup.attribute_name
      ORDER BY id ASC
      LIMIT (dup.cnt - 1)
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_request_item_attributes_name" ON "request_item_attributes" USING btree ("request_item_id","attribute_name");
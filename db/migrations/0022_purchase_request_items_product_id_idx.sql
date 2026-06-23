-- Performance audit DB-01: add missing index on purchase_request_items.product_id.
-- Queries that find all items for a specific product (kardex, reports,
-- trazabilidad) were doing sequential scans without this index.
CREATE INDEX IF NOT EXISTS purchase_request_items_product_id_idx
  ON purchase_request_items (product_id);

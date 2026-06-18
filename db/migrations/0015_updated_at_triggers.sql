-- DB-05/06: Automatic updated_at trigger for all tables that declare the column.
-- Prevents bugs where a manual UPDATE forgets to set updated_at.
--
-- Pattern: one shared trigger function + a BEFORE UPDATE trigger per table.
-- Adding a new table = add one CREATE TRIGGER line at the bottom.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Users
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Worksites
DROP TRIGGER IF EXISTS worksites_set_updated_at ON worksites;
CREATE TRIGGER worksites_set_updated_at
  BEFORE UPDATE ON worksites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Products
DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Suppliers
DROP TRIGGER IF EXISTS suppliers_set_updated_at ON suppliers;
CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Purchase requests
DROP TRIGGER IF EXISTS purchase_requests_set_updated_at ON purchase_requests;
CREATE TRIGGER purchase_requests_set_updated_at
  BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Purchase request items
DROP TRIGGER IF EXISTS purchase_request_items_set_updated_at ON purchase_request_items;
CREATE TRIGGER purchase_request_items_set_updated_at
  BEFORE UPDATE ON purchase_request_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Purchase orders
DROP TRIGGER IF EXISTS purchase_orders_set_updated_at ON purchase_orders;
CREATE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Code sequences
DROP TRIGGER IF EXISTS code_sequences_set_updated_at ON code_sequences;
CREATE TRIGGER code_sequences_set_updated_at
  BEFORE UPDATE ON code_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "product_attribute_templates" ADD COLUMN "size_family" text;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD COLUMN "size_family" text;--> statement-breakpoint
ALTER TABLE "request_item_attributes" ADD CONSTRAINT "request_item_attributes_value_length" CHECK (char_length("request_item_attributes"."value") > 0 AND char_length("request_item_attributes"."value") <= 64);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_request_item_attribute_value()
RETURNS TRIGGER AS $$
DECLARE
  attr_type text;
  attr_options text;
  parsed_options text[];
BEGIN
  IF NEW.attribute_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT pa.type, pa.options INTO attr_type, attr_options
  FROM product_attributes pa
  WHERE pa.id = NEW.attribute_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF attr_type IS DISTINCT FROM 'select' THEN
    RETURN NEW;
  END IF;
  BEGIN
    parsed_options := ARRAY(SELECT jsonb_array_elements_text(attr_options::jsonb));
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF parsed_options IS NULL OR array_length(parsed_options, 1) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.value = ANY(parsed_options)) THEN
    RAISE EXCEPTION 'request_item_attributes.value ''%'' is not one of the valid options: %',
      NEW.value, array_to_string(parsed_options, ', ');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_check_request_item_attribute_value
  BEFORE INSERT OR UPDATE ON request_item_attributes
  FOR EACH ROW EXECUTE FUNCTION check_request_item_attribute_value();
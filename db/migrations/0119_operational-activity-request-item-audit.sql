-- Algunas transiciones históricas usan request_item en audit_log y otras
-- purchase_request_item. Ambas representan el mismo ítem de solicitud y deben
-- producir una actividad segura y visible para el solicitante autorizado.
CREATE OR REPLACE FUNCTION public.record_operational_activity_from_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_worksite_id text;
  target_module text;
  target_event_type text := 'audit.' || NEW.action;
  target_status text := COALESCE((NEW.new_state::jsonb) ->> 'status', '');
BEGIN
  CASE NEW.entity_type
    WHEN 'purchase_request' THEN
      SELECT worksite_id INTO target_worksite_id FROM purchase_requests WHERE id = NEW.entity_id;
      target_module := 'solicitudes';
    WHEN 'purchase_request_item', 'request_item' THEN
      SELECT pr.worksite_id INTO target_worksite_id
      FROM purchase_request_items pri
      INNER JOIN purchase_requests pr ON pr.id = pri.request_id
      WHERE pri.id = NEW.entity_id;
      target_module := 'solicitudes';
    WHEN 'purchase_order' THEN
      SELECT worksite_id INTO target_worksite_id FROM purchase_orders WHERE id = NEW.entity_id;
      target_module := 'compras';
    WHEN 'receipt' THEN
      SELECT po.worksite_id INTO target_worksite_id
      FROM receipts r INNER JOIN purchase_orders po ON po.id = r.purchase_order_id
      WHERE r.id = NEW.entity_id;
      target_module := 'recepciones';
    WHEN 'delivery' THEN
      SELECT worksite_id INTO target_worksite_id FROM deliveries WHERE id = NEW.entity_id;
      target_module := 'entregas';
    ELSE
      RETURN NEW;
  END CASE;

  IF target_worksite_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.entity_type = 'purchase_order' THEN
    CASE
      WHEN NEW.action = 'create' THEN target_event_type := 'purchase_order.created';
      WHEN NEW.action = 'cancel' OR target_status = 'cancelled' THEN target_event_type := 'purchase_order.cancelled';
      WHEN target_status = 'issued' THEN target_event_type := 'purchase_order.issued';
      WHEN target_status = 'sent' THEN target_event_type := 'purchase_order.sent';
      WHEN target_status = 'supplier_confirmed' THEN target_event_type := 'purchase_order.confirmed';
    END CASE;
  ELSIF NEW.entity_type = 'purchase_request' THEN
    CASE
      WHEN NEW.action = 'cancel' OR target_status = 'cancelled' THEN target_event_type := 'purchase_request.cancelled';
      WHEN target_status = 'submitted' THEN target_event_type := 'purchase_request.submitted';
    END CASE;
  ELSIF NEW.entity_type IN ('purchase_request_item', 'request_item') THEN
    CASE target_status
      WHEN 'approved' THEN target_event_type := 'request_item.approved';
      WHEN 'rejected' THEN target_event_type := 'request_item.rejected';
      WHEN 'returned' THEN target_event_type := 'request_item.returned';
    END CASE;
  ELSIF NEW.entity_type = 'receipt' AND NEW.action = 'create' THEN
    target_event_type := 'receipt.registered';
  ELSIF NEW.entity_type = 'delivery' AND NEW.action = 'create' THEN
    target_event_type := 'delivery.registered';
  END IF;

  INSERT INTO operational_activity_events (
    id, event_type, module, entity_type, entity_id, entity_code,
    worksite_id, actor_user_id, payload
  ) VALUES (
    'opevt-' || md5(random()::text || clock_timestamp()::text || NEW.id),
    target_event_type,
    target_module,
    NEW.entity_type,
    NEW.entity_id,
    NEW.entity_code,
    target_worksite_id,
    NEW.user_id,
    jsonb_strip_nulls(jsonb_build_object('action', NEW.action, 'status', NULLIF(target_status, '')))
  );
  RETURN NEW;
END;
$$;

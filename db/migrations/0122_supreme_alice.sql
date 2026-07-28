ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste')
  );
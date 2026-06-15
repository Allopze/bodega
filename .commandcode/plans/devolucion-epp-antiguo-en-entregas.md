# Plan: Devolución de EPP antiguo en entregas

## Decisiones tomadas (vía grill-me)

1. **Obligatoriedad**: Opcional — toggle "Devolver EPP antiguo" en el form de entrega
2. **Producto**: Seleccionable del catálogo de la faena **o** texto libre
3. **Destino**: No vuelve al stock usable → nuevo tipo movimiento `egreso_desecho` que solo registra en `inventoryMovements` sin afectar `worksiteStock.quantity`
4. **UI**: Mismo formulario de entrega, sección colapsable opcional
5. **Campos**: Producto (catalogo/libre), cantidad, motivo/estado (select), notas

---

## Archivos a modificar

### 1. `db/schema/stock.ts` — CHECK constraint
- Agregar `'egreso_desecho'` al CHECK de `inventory_movements.type`

### 2. `db/schema/receiving.ts` — Columnas en `deliveryItems`
Agregar columnas opcionales:
- `returnQuantity` (`real`, nullable)
- `returnProductId` (`text`, nullable, FK → products.id)
- `returnProductNameFree` (`text`, nullable)
- `returnReason` (`text`, nullable)
- `returnNotes` (`text`, nullable)

### 3. Migración Drizzle
- Crear migración que agregue las columnas a `delivery_items` y actualice CHECK constraint en `inventory_movements`

### 4. `lib/services/stock.ts`
- Agregar `'egreso_desecho'` al tipo `MovementType`
- En `applyMovementTx`: cuando `type === 'egreso_desecho'`, saltar `applyStockDelta` (no afecta stock) pero seguir registrando en `inventoryMovements` y auditoría

### 5. `lib/validation/operations.ts`
- Agregar campos opcionales a `workerDeliverySchema`:
  - `returnProductId: z.string().nullable().optional()`
  - `returnProductNameFree: z.string().max(120).nullable().optional()`
  - `returnQuantity: positiveQuantitySchema.nullable().optional()`
  - `returnReason: z.enum(['desgastado', 'dañado', 'vencido', 'otro']).nullable().optional()`
  - `returnNotes: z.string().max(300).nullable().optional()`

### 6. `lib/services/deliveries.ts`
- Agregar campos opcionales a `RegisterWorkerEppDeliveryInput`:
  - `returnProductId`, `returnProductNameFree`, `returnQuantity`, `returnReason`, `returnNotes`
- En `registerWorkerEppDelivery`, después del insert de delivery + item:
  - Si `input.returnQuantity` está presente → actualizar `deliveryItems` con los campos de return
  - Llamar `applyMovementTx` con `type: 'egreso_desecho'`, `quantity: +returnQuantity` (positivo, pero sin afectar stock)
  - Incluir en el audit record

### 7. `app/(app)/entregas/actions.ts`
- Agregar parsing de los nuevos campos del FormData
- Pasarlos al servicio

### 8. `app/(app)/entregas/delivery-form.tsx`
- Agregar sección colapsable "Devolver EPP antiguo" (un checkbox/toggle)
- Al activarse, mostrar:
  - Select de productos del catálogo (filtrado por faena seleccionada)
  - Input de texto libre para producto (alternativa/fallback)
  - Input cantidad (number)
  - Select motivo: Desgastado, Dañado, Vencido, Otro
  - Textarea notas
- Cargar `products` disponibles en la faena como prop del server component

### 9. `app/(app)/entregas/page.tsx`
- Pasar lista de productos disponibles por faena al form para el select de devolución

### 10. `app/(app)/bodega/kardex-table.tsx`
- Agregar label `egreso_desecho: "Retiro"` a `MOVEMENT_TYPE_LABELS`
- Agregar clase CSS (rojo/anaranjado, es un egreso)

### 11. Tests
- Actualizar `lib/__tests__/operations-validation.test.ts`: agregar casos para nuevos campos
- Actualizar `lib/__tests__/full-flow-integration.test.ts`: agregar test de entrega con devolución

---

## Flujo completo

```
DeliveryForm
  └─ toggle "Devolver EPP antiguo" (opcional)
       ├─ Select producto catálogo
       ├─ Input texto libre (fallback)
       ├─ Input cantidad
       ├─ Select motivo {desgastado, dañado, vencido, otro}
       └─ Textarea notas
       │
registerWorkerDeliveryAction (server action)
  └─ workerDeliverySchema.safeParse() ← nuevos campos
  └─ registerWorkerEppDelivery({..., returnFields})
       │
       ├─ INSERT delivery (header)
       ├─ INSERT delivery_item (con returnQuantity, returnReason, etc.)
       ├─ applyMovementTx({ type: 'egreso_desecho', ... }) ← solo historial, no stock
       └─ recordAudit(...)
```

---

## Verificación

1. `npx tsc --noEmit` — typecheck limpio
2. `npx vitest run` — tests existentes + nuevos pasan
3. Prueba manual: abrir `/entregas`, toggle devolución, rellenar campos, registrar entrega, verificar en kardex que aparece movimiento "Retiro"

/**
 * modules/receiving/schema.ts
 *
 * Tablas Drizzle del módulo receiving.
 * Nota: deliveries y deliveryItems también viven en db/schema/receiving.ts
 * pero pertenecen al módulo deliveries (ver modules/deliveries/schema.ts).
 */

export {
  receipts,
  receiptItems,
  receiptsRelations,
  receiptItemsRelations,
} from "@/db/schema"

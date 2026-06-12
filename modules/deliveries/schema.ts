/**
 * modules/deliveries/schema.ts
 *
 * Tablas Drizzle del módulo deliveries.
 * deliveries y deliveryItems viven físicamente en db/schema/receiving.ts pero
 * pertenecen semánticamente a este módulo.
 */

export {
  deliveries,
  deliveryItems,
  deliveriesRelations,
  deliveryItemsRelations,
} from "@/db/schema"

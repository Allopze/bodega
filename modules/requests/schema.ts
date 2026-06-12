/**
 * modules/requests/schema.ts
 *
 * Tablas Drizzle del módulo requests.
 * Nota: approvalDecisions también vive en db/schema/requests.ts pero
 * es propiedad del módulo approvals (ver modules/approvals/schema.ts).
 */

export {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  purchaseRequestsRelations,
  purchaseRequestItemsRelations,
  requestItemAttributesRelations,
} from "@/db/schema"

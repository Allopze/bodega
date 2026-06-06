import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites, costCenters, workers } from "./worksites"
import { products, productAttributes } from "./products"

/* ── Purchase Request States ─────────────────────────────────────────────── */
// draft | submitted | in_review | partially_approved | approved
// rejected | returned | in_purchasing | closed | cancelled

/* ── Request Item States (the core lifecycle) ────────────────────────────── */
// draft | requested | approved | rejected | returned | postponed
// pending_purchase | in_purchase_order | purchased
// partially_received | received | partially_delivered | delivered

/* ── Purchase Requests ───────────────────────────────────────────────────── */
export const purchaseRequests = sqliteTable("purchase_requests", {
  id:           text("id").primaryKey(),
  code:         text("code").notNull().unique(),    // e.g. "SOL-2026-0042"
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  requesterId:  text("requester_id").notNull().references(() => users.id),
  costCenterId: text("cost_center_id").references(() => costCenters.id),
  urgency:      text("urgency").notNull().default("normal"), // normal | high | critical
  status:       text("status").notNull().default("draft"),
  submittedAt:  text("submitted_at"),
  closedAt:     text("closed_at"),
  notes:        text("notes"),
  createdAt:    text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:    text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Purchase Request Items ───────────────────────────────────────────────── */
export const purchaseRequestItems = sqliteTable("purchase_request_items", {
  id:             text("id").primaryKey(),
  requestId:      text("request_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  productId:      text("product_id").references(() => products.id),
  // For uncatalogued products:
  productNameFree: text("product_name_free"),
  quantity:        real("quantity").notNull(),
  unitOfMeasure:   text("unit_of_measure").notNull().default("unidad"),
  status:          text("status").notNull().default("draft"),
  urgency:         text("urgency"),
  requiredDate:    text("required_date"),
  workerId:        text("worker_id").references(() => workers.id),  // EPP → specific worker
  sortOrder:       integer("sort_order").notNull().default(0),
  notes:           text("notes"),
  createdAt:       text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:       text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Request Item Attributes (talla, color, medida, etc.) ────────────────── */
export const requestItemAttributes = sqliteTable("request_item_attributes", {
  id:              text("id").primaryKey(),
  requestItemId:   text("request_item_id").notNull().references(() => purchaseRequestItems.id, { onDelete: "cascade" }),
  attributeId:     text("attribute_id").references(() => productAttributes.id),
  attributeName:   text("attribute_name").notNull(),  // denormalized for free-text items
  value:           text("value").notNull(),
})

/* ── Approval Decisions ───────────────────────────────────────────────────── */
export const approvalDecisions = sqliteTable("approval_decisions", {
  id:             text("id").primaryKey(),
  requestItemId:  text("request_item_id").references(() => purchaseRequestItems.id),
  requestId:      text("request_id").references(() => purchaseRequests.id),
  type:           text("type").notNull(),            // approve | reject | return | modify
  decidedBy:      text("decided_by").notNull().references(() => users.id),
  decidedAt:      text("decided_at").notNull().default(sql`(datetime('now'))`),
  reason:         text("reason"),
  modifiedQty:    real("modified_qty"),              // if quantity was modified during approval
  roleContext:    text("role_context"),               // 'jefa_chome' | 'secretaria' | 'prevencionista' | 'admin'
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const purchaseRequestsRelations = relations(purchaseRequests, ({ one, many }) => ({
  worksite:   one(worksites, { fields: [purchaseRequests.worksiteId], references: [worksites.id] }),
  requester:  one(users, { fields: [purchaseRequests.requesterId], references: [users.id] }),
  costCenter: one(costCenters, { fields: [purchaseRequests.costCenterId], references: [costCenters.id] }),
  items:      many(purchaseRequestItems),
}))

export const purchaseRequestItemsRelations = relations(purchaseRequestItems, ({ one, many }) => ({
  request:           one(purchaseRequests, { fields: [purchaseRequestItems.requestId], references: [purchaseRequests.id] }),
  product:           one(products, { fields: [purchaseRequestItems.productId], references: [products.id] }),
  worker:            one(workers, { fields: [purchaseRequestItems.workerId], references: [workers.id] }),
  attributes:        many(requestItemAttributes),
  approvalDecisions: many(approvalDecisions),
}))

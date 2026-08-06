/**
 * db/schema/billing.ts
 *
 * Modelo normalizado de Facturación y Cobranza.
 *
 * Reglas que sostienen este esquema:
 *
 * 1. **Normalizado, no acoplado al proveedor.** Ninguna columna refleja el
 *    formato de FacturaEnLínea ni de Chipax. Lo específico de cada fuente vive
 *    en `billing_external_refs`.
 * 2. **Una factura interna, N referencias externas.** Si el mismo documento
 *    aparece en dos proveedores, sigue siendo UNA factura con dos referencias.
 * 3. **Dirección explícita.** `direction` distingue venta de compra; el módulo
 *    nunca mezcla cuentas por cobrar con facturas de proveedor sin decirlo.
 * 4. **El estado de pago se calcula desde los pagos**, no desde un booleano.
 *    `payment_status` es una caché derivada y se recalcula al tocar pagos.
 * 5. **Nada automático sobrescribe una decisión humana.** Los vínculos y los
 *    pagos nacen `suggested`; solo una persona con permiso los confirma.
 * 6. **Dinero:** `numeric(14,2)` en Postgres (exacto). Toda aritmética pasa por
 *    `lib/services/billing/money.ts`, que opera en unidades menores enteras.
 * 7. **Monedas:** cada monto lleva su moneda; nada suma monedas distintas.
 */

import { relations, sql } from "drizzle-orm"
import { pgTable, text, boolean, integer, numeric, jsonb, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { costCenters } from "./cost-centers"
import { clients, contracts } from "./clients"

/* ── Vocabulario del módulo ──────────────────────────────────────────────── */

/** Dirección del documento. `sale` = lo que Chome cobra; `purchase` = lo que paga. */
export type BillingDirection = "sale" | "purchase"

/** Proveedor de origen del dato. `manual` = lo cargó una persona. */
export type BillingProviderId = "factura_en_linea" | "chipax" | "manual"

const PROVIDER_SQL = `('factura_en_linea', 'chipax', 'manual')`

/* ── Invoices (Facturas normalizadas) ────────────────────────────────────── */

/**
 * Factura (o nota de crédito/débito) en el modelo interno.
 *
 * Identidad tributaria: `(direction, doc_type, folio, issuer_tax_id, receiver_tax_id)`.
 * El folio no es único global — la misma serie puede ser factura 33 y NC 61 — y
 * emisor+receptor cierran el caso de dos empresas con la misma numeración.
 */
export const billingInvoices = pgTable("billing_invoices", {
  id:                text("id").primaryKey(),

  direction:         text("direction").notNull().$type<BillingDirection>(),
  /** Código de tipo de documento del SII: 33, 34, 61, 56, 39, 41… */
  docType:           text("doc_type").notNull(),
  folio:             integer("folio").notNull(),

  issuerTaxId:       text("issuer_tax_id").notNull(),
  issuerName:        text("issuer_name").notNull(),
  receiverTaxId:     text("receiver_tax_id").notNull(),
  receiverName:      text("receiver_name").notNull(),

  issueDate:         text("issue_date").notNull(),          // "YYYY-MM-DD"
  /** Vencimiento. Derivado del contrato/cliente o puesto a mano; ver `dueDateSource`. */
  dueDate:           text("due_date"),                      // "YYYY-MM-DD"
  /** De dónde salió `dueDate`. `manual` nunca se sobrescribe automáticamente. */
  dueDateSource:     text("due_date_source").$type<"contract" | "client" | "provider" | "manual">(),

  currency:          text("currency").notNull().default("CLP"),
  netAmount:         numeric("net_amount", { precision: 14, scale: 2, mode: "number" }),
  taxAmount:         numeric("tax_amount", { precision: 14, scale: 2, mode: "number" }),
  exemptAmount:      numeric("exempt_amount", { precision: 14, scale: 2, mode: "number" }),
  /** Total del documento. Negativo en notas de crédito. */
  totalAmount:       numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),

  /**
   * Estado documental/tributario. `void` (anulada) excluye la factura de toda
   * agregación de facturación válida.
   */
  documentStatus:    text("document_status").notNull().$type<"issued" | "accepted" | "rejected" | "void" | "draft" | "unknown">().default("unknown"),
  /**
   * Caché derivada de los pagos confirmados. Fuente de verdad:
   * `recomputeInvoicePaymentStatus`. Nunca se edita a mano.
   */
  paymentStatus:     text("payment_status").notNull().$type<"unpaid" | "partial" | "paid" | "overpaid">().default("unpaid"),
  /** Estado interno de gestión de cobro. Solo lo mueve una persona. */
  collectionStatus:  text("collection_status").notNull().$type<"none" | "in_progress" | "committed" | "disputed" | "closed" | "written_off">().default("none"),

  /** Suma de pagos confirmados, en la moneda de la factura. Caché derivada. */
  paidAmount:        numeric("paid_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),

  /** Proveedor que originó el registro. */
  source:            text("source").notNull().$type<BillingProviderId>(),
  sourceLastSyncedAt: timestamp("source_last_synced_at", { withTimezone: true, mode: "string" }),

  /** Responsable interno de la cobranza de esta factura. */
  ownerUserId:       text("owner_user_id").references(() => users.id, { onDelete: "set null" }),

  /** Notas internas. Nunca guarda secretos ni credenciales. */
  notes:             text("notes"),

  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_invoices_identity_unique")
    .on(table.direction, table.docType, table.folio, table.issuerTaxId, table.receiverTaxId),
  index("billing_invoices_direction_issue_idx").on(table.direction, table.issueDate),
  index("billing_invoices_due_idx").on(table.dueDate),
  index("billing_invoices_payment_status_idx").on(table.paymentStatus),
  index("billing_invoices_collection_status_idx").on(table.collectionStatus),
  index("billing_invoices_receiver_idx").on(table.receiverTaxId),
  index("billing_invoices_issuer_idx").on(table.issuerTaxId),
  index("billing_invoices_owner_idx").on(table.ownerUserId),
  check("billing_invoices_direction_valid", sql`${table.direction} IN ('sale', 'purchase')`),
  check("billing_invoices_document_status_valid", sql`${table.documentStatus} IN ('issued', 'accepted', 'rejected', 'void', 'draft', 'unknown')`),
  check("billing_invoices_payment_status_valid", sql`${table.paymentStatus} IN ('unpaid', 'partial', 'paid', 'overpaid')`),
  check("billing_invoices_collection_status_valid", sql`${table.collectionStatus} IN ('none', 'in_progress', 'committed', 'disputed', 'closed', 'written_off')`),
  check("billing_invoices_due_date_source_valid", sql`${table.dueDateSource} IS NULL OR ${table.dueDateSource} IN ('contract', 'client', 'provider', 'manual')`),
  check("billing_invoices_source_valid", sql`${table.source} IN ${sql.raw(PROVIDER_SQL)}`),
  check("billing_invoices_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("billing_invoices_folio_positive", sql`${table.folio} > 0`),
  check("billing_invoices_dates_format", sql`${table.issueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (${table.dueDate} IS NULL OR ${table.dueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$')`),
])

/* ── Invoice Items (Ítems) ───────────────────────────────────────────────── */

/**
 * Ítems del documento. Solo se crean cuando la fuente los entrega (XML del DTE
 * o carga manual); una fuente que solo trae totales no genera ítems inventados.
 */
export const billingInvoiceItems = pgTable("billing_invoice_items", {
  id:               text("id").primaryKey(),
  invoiceId:        text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  /** Identificador del ítem en la fuente externa, si lo trae. */
  externalItemId:   text("external_item_id"),
  description:      text("description").notNull(),
  quantity:         numeric("quantity", { precision: 14, scale: 4, mode: "number" }),
  unit:             text("unit"),
  unitPrice:        numeric("unit_price", { precision: 14, scale: 2, mode: "number" }),
  discountAmount:   numeric("discount_amount", { precision: 14, scale: 2, mode: "number" }),
  netAmount:        numeric("net_amount", { precision: 14, scale: 2, mode: "number" }),
  taxAmount:        numeric("tax_amount", { precision: 14, scale: 2, mode: "number" }),
  totalAmount:      numeric("total_amount", { precision: 14, scale: 2, mode: "number" }),
  sortOrder:        integer("sort_order").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_invoice_items_invoice_idx").on(table.invoiceId, table.sortOrder),
  check("billing_invoice_items_description_nonempty", sql`length(${table.description}) > 0`),
])

/* ── External References (Referencias externas) ──────────────────────────── */

/**
 * Presencia de una factura interna en un proveedor externo. Una factura puede
 * tener varias: es lo que permite que FacturaEnLínea y Chipax describan el
 * MISMO documento sin duplicarlo, y comparar diferencias entre fuentes.
 *
 * `payloadHash` detecta cambios en la fuente; `snapshot` guarda los campos
 * normalizados que ese proveedor reportó (nunca credenciales ni el XML entero).
 */
export const billingExternalRefs = pgTable("billing_external_refs", {
  id:             text("id").primaryKey(),
  invoiceId:      text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  provider:       text("provider").notNull().$type<BillingProviderId>(),
  /** Id del documento en el proveedor. Cuando no hay uno, se usa la clave natural. */
  externalId:     text("external_id").notNull(),
  externalFolio:  text("external_folio"),
  externalStatus: text("external_status"),
  /** Cuenta/empresa dentro del proveedor (ej: CodEmp del portal). */
  accountRef:     text("account_ref"),
  /** URL del documento en el proveedor, si la expone. */
  documentUrl:    text("document_url"),
  payloadHash:    text("payload_hash").notNull(),
  /** Campos normalizados reportados por esta fuente, para comparar diferencias. */
  snapshot:       jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
  firstSeenAt:    timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSeenAt:     timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Un proveedor no puede tener dos referencias al mismo documento externo.
  uniqueIndex("billing_external_refs_provider_external_unique").on(table.provider, table.externalId),
  // Ni dos referencias del mismo proveedor a la misma factura interna.
  uniqueIndex("billing_external_refs_invoice_provider_unique").on(table.invoiceId, table.provider),
  index("billing_external_refs_hash_idx").on(table.payloadHash),
  check("billing_external_refs_provider_valid", sql`${table.provider} IN ${sql.raw(PROVIDER_SQL)}`),
  check("billing_external_refs_external_id_nonempty", sql`length(${table.externalId}) > 0`),
])

/* ── Operational Links (Relación con la operación interna) ───────────────── */

/**
 * Vínculo entre una factura y la operación interna. Es N-a-N a propósito: una
 * factura puede cubrir varios períodos, faenas o servicios.
 *
 * `status` distingue una sugerencia automática de una confirmación humana:
 * el módulo nunca presenta una inferencia como un hecho.
 */
export const billingInvoiceLinks = pgTable("billing_invoice_links", {
  id:            text("id").primaryKey(),
  invoiceId:     text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),

  clientId:      text("client_id").references(() => clients.id, { onDelete: "set null" }),
  contractId:    text("contract_id").references(() => contracts.id, { onDelete: "set null" }),
  worksiteId:    text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  costCenterId:  text("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  proposalId:    text("proposal_id").references(() => billingProposals.id, { onDelete: "set null" }),

  /** Período de servicio que cubre este vínculo, "YYYY-MM". */
  servicePeriod: text("service_period"),
  /** Orden de compra que entregó el cliente para este cobro. */
  clientPoNumber: text("client_po_number"),
  /** Porción del total de la factura imputada a este vínculo. Null = todo. */
  amount:        numeric("amount", { precision: 14, scale: 2, mode: "number" }),

  status:        text("status").notNull().$type<"suggested" | "confirmed" | "rejected">().default("suggested"),
  /** Cómo se originó: match automático o decisión humana. */
  matchedBy:     text("matched_by").notNull().$type<"auto" | "user">().default("auto"),
  /** Nivel de confianza de la sugerencia automática. */
  confidence:    text("confidence").$type<"high" | "medium" | "low">(),
  /** Evidencia legible de la sugerencia (qué coincidió). Sin datos sensibles. */
  evidence:      jsonb("evidence").notNull().default(sql`'{}'::jsonb`),

  confirmedBy:   text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
  confirmedAt:   timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  createdBy:     text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_invoice_links_invoice_idx").on(table.invoiceId, table.status),
  index("billing_invoice_links_client_idx").on(table.clientId),
  index("billing_invoice_links_contract_period_idx").on(table.contractId, table.servicePeriod),
  index("billing_invoice_links_worksite_idx").on(table.worksiteId),
  index("billing_invoice_links_proposal_idx").on(table.proposalId),
  check("billing_invoice_links_status_valid", sql`${table.status} IN ('suggested', 'confirmed', 'rejected')`),
  check("billing_invoice_links_matched_by_valid", sql`${table.matchedBy} IN ('auto', 'user')`),
  check("billing_invoice_links_confidence_valid", sql`${table.confidence} IS NULL OR ${table.confidence} IN ('high', 'medium', 'low')`),
  check("billing_invoice_links_period_format", sql`${table.servicePeriod} IS NULL OR ${table.servicePeriod} ~ '^\\d{4}-\\d{2}$'`),
  // Un vínculo tiene que apuntar a algo.
  check("billing_invoice_links_target_present", sql`
    ${table.clientId} IS NOT NULL OR ${table.contractId} IS NOT NULL
    OR ${table.worksiteId} IS NOT NULL OR ${table.proposalId} IS NOT NULL
  `),
  // Confirmado exige autor y fecha: no hay confirmaciones anónimas.
  check("billing_invoice_links_confirmation_traced", sql`
    ${table.status} <> 'confirmed'
    OR (${table.confirmedBy} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL)
  `),
])

/* ── Bank Transactions (Movimientos bancarios) ───────────────────────────── */

/**
 * Movimiento bancario importado de una fuente financiera (Chipax cuando esté
 * disponible) o cargado a mano. Es el insumo del motor de conciliación.
 *
 * `accountRef` guarda la cuenta **enmascarada**; el número completo no entra.
 */
export const billingBankTransactions = pgTable("billing_bank_transactions", {
  id:              text("id").primaryKey(),
  provider:        text("provider").notNull().$type<BillingProviderId>(),
  /** Id del movimiento en el proveedor. Único por proveedor: evita duplicados. */
  externalId:      text("external_id").notNull(),
  transactionDate: text("transaction_date").notNull(),      // "YYYY-MM-DD"
  amount:          numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  currency:        text("currency").notNull().default("CLP"),
  /** Glosa del banco. Dato NO confiable: se sanitiza antes de mostrar o exportar. */
  description:     text("description"),
  counterpartyName:  text("counterparty_name"),
  counterpartyTaxId: text("counterparty_tax_id"),
  /** Cuenta bancaria enmascarada, ej: "****4321". */
  accountRef:      text("account_ref"),
  /** Monto ya imputado a facturas por asociaciones confirmadas. Caché derivada. */
  allocatedAmount: numeric("allocated_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  payloadHash:     text("payload_hash").notNull(),
  syncedAt:        timestamp("synced_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_bank_tx_provider_external_unique").on(table.provider, table.externalId),
  index("billing_bank_tx_date_idx").on(table.transactionDate),
  index("billing_bank_tx_counterparty_idx").on(table.counterpartyTaxId),
  check("billing_bank_tx_provider_valid", sql`${table.provider} IN ${sql.raw(PROVIDER_SQL)}`),
  check("billing_bank_tx_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("billing_bank_tx_date_format", sql`${table.transactionDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
])

/* ── Payments (Pagos) ────────────────────────────────────────────────────── */

/**
 * Pago (o parte de un pago) imputado a una factura.
 *
 * Una factura puede tener 0..N pagos y un movimiento bancario puede repartirse
 * entre varias facturas: la relación es N-a-N vía esta tabla.
 *
 * `verificationStatus`:
 *   - `suggested`: el motor propuso la asociación. NO cuenta como cobrado.
 *   - `confirmed`: una persona autorizada la validó. Cuenta como cobrado.
 *   - `rejected`: descartada a propósito; no se vuelve a proponer nunca.
 *   - `reverted`: una confirmación que se deshizo por error. No cuenta como
 *     cobrado, pero **sí** vuelve a ser proponible: descartar es una decisión
 *     sobre el vínculo, revertir es corregir un error de dedo, y tratarlos
 *     igual dejaba el movimiento inimputable para siempre contra esa factura
 *     (H-15, AUDITORIA_BUGS_2026-08-05.md).
 */
export const billingInvoicePayments = pgTable("billing_invoice_payments", {
  id:                 text("id").primaryKey(),
  invoiceId:          text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  /** Movimiento bancario de origen, si la asociación viene de la cartola. */
  bankTransactionId:  text("bank_transaction_id").references(() => billingBankTransactions.id, { onDelete: "set null" }),

  paymentDate:        text("payment_date").notNull(),        // "YYYY-MM-DD"
  amount:             numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  currency:           text("currency").notNull().default("CLP"),
  /** Medio declarado: transferencia, cheque, factoring, etc. Texto libre acotado. */
  method:             text("method"),

  source:             text("source").notNull().$type<BillingProviderId>().default("manual"),
  /** Id de la transacción en la fuente externa, si aplica. */
  externalTransactionId: text("external_transaction_id"),

  verificationStatus: text("verification_status").notNull().$type<"suggested" | "confirmed" | "rejected" | "reverted">().default("suggested"),
  confidence:         text("confidence").$type<"high" | "medium" | "low">(),
  /** Qué sustenta la sugerencia: monto, RUT, folio en la glosa… */
  evidence:           jsonb("evidence").notNull().default(sql`'{}'::jsonb`),

  matchedBy:          text("matched_by").notNull().$type<"auto" | "user">().default("auto"),
  confirmedBy:        text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
  confirmedAt:        timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  rejectedBy:         text("rejected_by").references(() => users.id, { onDelete: "set null" }),
  rejectedAt:         timestamp("rejected_at", { withTimezone: true, mode: "string" }),
  rejectionReason:    text("rejection_reason"),

  notes:              text("notes"),
  createdBy:          text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_invoice_payments_invoice_idx").on(table.invoiceId, table.verificationStatus),
  index("billing_invoice_payments_bank_tx_idx").on(table.bankTransactionId),
  index("billing_invoice_payments_date_idx").on(table.paymentDate),
  // Un movimiento bancario no puede imputarse dos veces a la misma factura.
  uniqueIndex("billing_invoice_payments_invoice_bank_tx_unique")
    .on(table.invoiceId, table.bankTransactionId),
  check("billing_invoice_payments_status_valid", sql`${table.verificationStatus} IN ('suggested', 'confirmed', 'rejected', 'reverted')`),
  check("billing_invoice_payments_matched_by_valid", sql`${table.matchedBy} IN ('auto', 'user')`),
  check("billing_invoice_payments_source_valid", sql`${table.source} IN ${sql.raw(PROVIDER_SQL)}`),
  check("billing_invoice_payments_confidence_valid", sql`${table.confidence} IS NULL OR ${table.confidence} IN ('high', 'medium', 'low')`),
  check("billing_invoice_payments_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("billing_invoice_payments_date_format", sql`${table.paymentDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  // Un pago de monto cero no informa nada; el signo lo define la factura (NC negativa).
  check("billing_invoice_payments_amount_nonzero", sql`${table.amount} <> 0`),
  check("billing_invoice_payments_confirmation_traced", sql`
    ${table.verificationStatus} <> 'confirmed'
    OR (${table.confirmedBy} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL)
  `),
])

/* ── Collection Actions (Gestiones de cobranza) ──────────────────────────── */

export const billingCollectionActions = pgTable("billing_collection_actions", {
  id:              text("id").primaryKey(),
  invoiceId:       text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  /** Contacto del cliente con quien se gestionó, si aplica. */
  contactName:     text("contact_name"),
  actionDate:      text("action_date").notNull(),            // "YYYY-MM-DD"
  actionType:      text("action_type").notNull().$type<"call" | "email" | "meeting" | "note" | "claim" | "commitment" | "dispute">(),
  channel:         text("channel").$type<"phone" | "email" | "in_person" | "portal" | "letter" | "other">(),
  outcome:         text("outcome").notNull().$type<"contacted" | "no_answer" | "promised_payment" | "disputed" | "escalated" | "resolved" | "other">(),
  /** Fecha comprometida de pago, si la gestión obtuvo un compromiso. */
  commitmentDate:  text("commitment_date"),                  // "YYYY-MM-DD"
  commitmentAmount: numeric("commitment_amount", { precision: 14, scale: 2, mode: "number" }),
  /** Próxima gestión programada. */
  nextActionDate:  text("next_action_date"),                 // "YYYY-MM-DD"
  notes:           text("notes"),
  /** Responsable de la gestión. */
  assigneeUserId:  text("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  createdBy:       text("created_by").notNull().references(() => users.id),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_collection_actions_invoice_idx").on(table.invoiceId, table.actionDate),
  index("billing_collection_actions_next_idx").on(table.nextActionDate),
  index("billing_collection_actions_assignee_idx").on(table.assigneeUserId),
  check("billing_collection_actions_type_valid", sql`${table.actionType} IN ('call', 'email', 'meeting', 'note', 'claim', 'commitment', 'dispute')`),
  check("billing_collection_actions_channel_valid", sql`${table.channel} IS NULL OR ${table.channel} IN ('phone', 'email', 'in_person', 'portal', 'letter', 'other')`),
  check("billing_collection_actions_outcome_valid", sql`${table.outcome} IN ('contacted', 'no_answer', 'promised_payment', 'disputed', 'escalated', 'resolved', 'other')`),
  check("billing_collection_actions_date_format", sql`${table.actionDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  // Un compromiso sin fecha no es un compromiso.
  check("billing_collection_actions_commitment_has_date", sql`
    ${table.actionType} <> 'commitment' OR ${table.commitmentDate} IS NOT NULL
  `),
])

/* ── Billing Proposals (Propuestas de facturación) ───────────────────────── */

/**
 * Preparación interna de un cobro: lo que Chome cree que debe facturar, antes
 * de que exista un documento tributario.
 *
 * Flujo: draft → in_review → (observed → in_review)* → approved → ready →
 * invoiced → closed. `rejected` y `cancelled` son salidas.
 *
 * Aprobar una propuesta **no** emite un DTE. La emisión sigue siendo manual en
 * el portal; la propuesta solo se vincula a la factura cuando ésta aparece.
 */
export const billingProposals = pgTable("billing_proposals", {
  id:               text("id").primaryKey(),
  /** Código legible, ej: "PF-2026-0012". */
  code:             text("code").notNull(),

  clientId:         text("client_id").notNull().references(() => clients.id),
  contractId:       text("contract_id").references(() => contracts.id, { onDelete: "set null" }),
  worksiteId:       text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  costCenterId:     text("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),

  /** Período de servicio a cobrar, "YYYY-MM". */
  servicePeriod:    text("service_period").notNull(),
  /** Rango concreto del servicio, cuando no coincide con el mes calendario. */
  serviceFrom:      text("service_from"),                   // "YYYY-MM-DD"
  serviceTo:        text("service_to"),                     // "YYYY-MM-DD"

  currency:         text("currency").notNull().default("CLP"),
  estimatedNet:     numeric("estimated_net", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  estimatedTax:     numeric("estimated_tax", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  estimatedTotal:   numeric("estimated_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),

  clientPoNumber:   text("client_po_number"),
  /** Antecedentes que faltan para poder facturar. Bloquea el paso a `ready`. */
  missingDocuments: text("missing_documents"),
  observations:     text("notes"),

  status:           text("status").notNull().$type<"draft" | "in_review" | "observed" | "approved" | "ready" | "invoiced" | "closed" | "rejected" | "cancelled">().default("draft"),

  ownerUserId:      text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedBy:      text("submitted_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt:      timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  reviewedBy:       text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:       timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  approvedBy:       text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt:       timestamp("approved_at", { withTimezone: true, mode: "string" }),
  /** Motivo de observación o rechazo. */
  decisionReason:   text("decision_reason"),

  createdBy:        text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_proposals_code_unique").on(table.code),
  // Un contrato no debería tener dos propuestas vivas del mismo período.
  uniqueIndex("billing_proposals_contract_period_unique")
    .on(table.contractId, table.servicePeriod)
    .where(sql`${table.status} NOT IN ('rejected', 'cancelled')`),
  index("billing_proposals_client_period_idx").on(table.clientId, table.servicePeriod),
  index("billing_proposals_status_idx").on(table.status),
  index("billing_proposals_worksite_idx").on(table.worksiteId),
  index("billing_proposals_owner_idx").on(table.ownerUserId),
  check("billing_proposals_status_valid", sql`${table.status} IN ('draft', 'in_review', 'observed', 'approved', 'ready', 'invoiced', 'closed', 'rejected', 'cancelled')`),
  check("billing_proposals_period_format", sql`${table.servicePeriod} ~ '^\\d{4}-\\d{2}$'`),
  check("billing_proposals_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("billing_proposals_amounts_non_negative", sql`${table.estimatedNet} >= 0 AND ${table.estimatedTax} >= 0 AND ${table.estimatedTotal} >= 0`),
  check("billing_proposals_service_range_ordered", sql`${table.serviceFrom} IS NULL OR ${table.serviceTo} IS NULL OR ${table.serviceFrom} <= ${table.serviceTo}`),
  check("billing_proposals_approval_traced", sql`
    ${table.status} NOT IN ('approved', 'ready', 'invoiced', 'closed')
    OR (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)
  `),
])

export const billingProposalItems = pgTable("billing_proposal_items", {
  id:          text("id").primaryKey(),
  proposalId:  text("proposal_id").notNull().references(() => billingProposals.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity:    numeric("quantity", { precision: 14, scale: 4, mode: "number" }).notNull().default(1),
  unit:        text("unit"),
  unitPrice:   numeric("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  netAmount:   numeric("net_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  /** True si el ítem es exento de IVA. */
  isExempt:    boolean("is_exempt").notNull().default(false),
  sortOrder:   integer("sort_order").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_proposal_items_proposal_idx").on(table.proposalId, table.sortOrder),
  check("billing_proposal_items_description_nonempty", sql`length(${table.description}) > 0`),
  check("billing_proposal_items_amounts_non_negative", sql`${table.quantity} >= 0 AND ${table.unitPrice} >= 0 AND ${table.netAmount} >= 0`),
])

/* ── Sync Runs (Corridas de sincronización por proveedor) ────────────────── */

/**
 * Corrida de sincronización de cualquier proveedor de facturación.
 *
 * Generaliza `dte_sync_runs` (que se conserva intacto para el módulo de
 * compras) con: dirección, cursor de reanudación, modo simulación, y el
 * desglose de duplicados y conflictos que exige la operación.
 */
export const billingSyncRuns = pgTable("billing_sync_runs", {
  id:                 text("id").primaryKey(),
  provider:           text("provider").notNull().$type<BillingProviderId>(),
  /** Qué se sincronizó: facturas de venta, de compra, o movimientos bancarios. */
  scope:              text("scope").notNull().$type<"sales_invoices" | "purchase_invoices" | "bank_transactions">(),
  trigger:            text("trigger").notNull().$type<"manual" | "cron" | "backfill">().default("manual"),
  status:             text("status").notNull().$type<"running" | "success" | "partial" | "failed" | "skipped">().default("running"),
  /** Modo simulación: consulta y compara, pero no escribe nada. */
  dryRun:             boolean("dry_run").notNull().default(false),

  periodFrom:         text("period_from"),                   // "YYYY-MM" o "YYYY-MM-DD"
  periodTo:           text("period_to"),
  /** Punto de reanudación dentro del período, cuando el proveedor lo permite. */
  cursor:             text("cursor"),

  recordsFetched:     integer("records_fetched").notNull().default(0),
  recordsCreated:     integer("records_created").notNull().default(0),
  recordsUpdated:     integer("records_updated").notNull().default(0),
  recordsUnchanged:   integer("records_unchanged").notNull().default(0),
  duplicatesDetected: integer("duplicates_detected").notNull().default(0),
  conflictsDetected:  integer("conflicts_detected").notNull().default(0),
  errorsCount:        integer("errors_count").notNull().default(0),
  /** Resumen de errores ya redactado: nunca credenciales ni cuerpos completos. */
  errorSummary:       text("error_summary"),
  /** Identificador de correlación para cruzar logs con esta corrida. */
  correlationId:      text("correlation_id").notNull(),

  triggeredBy:        text("triggered_by").references(() => users.id, { onDelete: "set null" }),
  startedAt:          timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt:         timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("billing_sync_runs_provider_scope_idx").on(table.provider, table.scope, table.startedAt),
  index("billing_sync_runs_status_idx").on(table.status),
  index("billing_sync_runs_correlation_idx").on(table.correlationId),
  // Un solo `running` por (proveedor, alcance, período): cierra la carrera de
  // dos corridas simultáneas sin necesitar un lock externo.
  uniqueIndex("billing_sync_runs_single_active_unique")
    .on(table.provider, table.scope, table.periodFrom)
    .where(sql`${table.status} = 'running'`),
  check("billing_sync_runs_provider_valid", sql`${table.provider} IN ${sql.raw(PROVIDER_SQL)}`),
  check("billing_sync_runs_scope_valid", sql`${table.scope} IN ('sales_invoices', 'purchase_invoices', 'bank_transactions')`),
  check("billing_sync_runs_trigger_valid", sql`${table.trigger} IN ('manual', 'cron', 'backfill')`),
  check("billing_sync_runs_status_valid", sql`${table.status} IN ('running', 'success', 'partial', 'failed', 'skipped')`),
])

/* ── Invoice Events (Historial del módulo) ───────────────────────────────── */

/**
 * Historial de cambios relevantes de una factura: estado, montos, vencimiento,
 * vínculos, pagos, gestiones, origen externo.
 *
 * Complementa `audit_log` (que registra el "quién tocó qué") con una línea de
 * tiempo legible en la pantalla de detalle. Nunca guarda tokens ni credenciales.
 */
export const billingInvoiceEvents = pgTable("billing_invoice_events", {
  id:          text("id").primaryKey(),
  invoiceId:   text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  eventType:   text("event_type").notNull(),
  /** Origen del cambio: sincronización, motor de sugerencias, o persona. */
  actorKind:   text("actor_kind").notNull().$type<"provider" | "system" | "user">(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Detalle legible del cambio (antes/después acotado). Sin datos sensibles. */
  detail:      jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  occurredAt:  timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("billing_invoice_events_invoice_idx").on(table.invoiceId, table.occurredAt),
  check("billing_invoice_events_actor_kind_valid", sql`${table.actorKind} IN ('provider', 'system', 'user')`),
  check("billing_invoice_events_type_nonempty", sql`length(${table.eventType}) > 0`),
])

/* ── Duplicate Candidates (Posibles duplicados entre fuentes) ────────────── */

/**
 * Par de facturas internas que podrían ser el mismo documento. Lo produce la
 * deduplicación cuando la coincidencia NO es exacta: una coincidencia exacta se
 * resuelve sola (misma identidad tributaria → misma fila), y una probable
 * requiere ojo humano porque fusionar mal pierde información.
 */
export const billingDuplicateCandidates = pgTable("billing_duplicate_candidates", {
  id:             text("id").primaryKey(),
  invoiceId:      text("invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  otherInvoiceId: text("other_invoice_id").notNull().references(() => billingInvoices.id, { onDelete: "cascade" }),
  classification: text("classification").notNull().$type<"probable" | "possible" | "conflict">(),
  /** Qué campos coincidieron y cuáles no. */
  evidence:       jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
  status:         text("status").notNull().$type<"open" | "merged" | "dismissed">().default("open"),
  /** Factura que quedó como superviviente tras la fusión. */
  mergedIntoId:   text("merged_into_id").references(() => billingInvoices.id, { onDelete: "set null" }),
  resolvedBy:     text("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_duplicate_candidates_pair_unique").on(table.invoiceId, table.otherInvoiceId),
  index("billing_duplicate_candidates_status_idx").on(table.status),
  check("billing_duplicate_candidates_classification_valid", sql`${table.classification} IN ('probable', 'possible', 'conflict')`),
  check("billing_duplicate_candidates_status_valid", sql`${table.status} IN ('open', 'merged', 'dismissed')`),
  check("billing_duplicate_candidates_distinct", sql`${table.invoiceId} <> ${table.otherInvoiceId}`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */

export const billingInvoicesRelations = relations(billingInvoices, ({ one, many }) => ({
  owner:        one(users, { fields: [billingInvoices.ownerUserId], references: [users.id] }),
  items:        many(billingInvoiceItems),
  externalRefs: many(billingExternalRefs),
  links:        many(billingInvoiceLinks),
  payments:     many(billingInvoicePayments),
  collectionActions: many(billingCollectionActions),
  events:       many(billingInvoiceEvents),
}))

export const billingInvoiceItemsRelations = relations(billingInvoiceItems, ({ one }) => ({
  invoice: one(billingInvoices, { fields: [billingInvoiceItems.invoiceId], references: [billingInvoices.id] }),
}))

export const billingExternalRefsRelations = relations(billingExternalRefs, ({ one }) => ({
  invoice: one(billingInvoices, { fields: [billingExternalRefs.invoiceId], references: [billingInvoices.id] }),
}))

export const billingInvoiceLinksRelations = relations(billingInvoiceLinks, ({ one }) => ({
  invoice:    one(billingInvoices, { fields: [billingInvoiceLinks.invoiceId], references: [billingInvoices.id] }),
  client:     one(clients, { fields: [billingInvoiceLinks.clientId], references: [clients.id] }),
  contract:   one(contracts, { fields: [billingInvoiceLinks.contractId], references: [contracts.id] }),
  worksite:   one(worksites, { fields: [billingInvoiceLinks.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [billingInvoiceLinks.costCenterId], references: [costCenters.id] }),
}))

export const billingBankTransactionsRelations = relations(billingBankTransactions, ({ many }) => ({
  payments: many(billingInvoicePayments),
}))

export const billingInvoicePaymentsRelations = relations(billingInvoicePayments, ({ one }) => ({
  invoice:         one(billingInvoices, { fields: [billingInvoicePayments.invoiceId], references: [billingInvoices.id] }),
  bankTransaction: one(billingBankTransactions, { fields: [billingInvoicePayments.bankTransactionId], references: [billingBankTransactions.id] }),
  confirmedByUser: one(users, { fields: [billingInvoicePayments.confirmedBy], references: [users.id] }),
}))

export const billingCollectionActionsRelations = relations(billingCollectionActions, ({ one }) => ({
  invoice:  one(billingInvoices, { fields: [billingCollectionActions.invoiceId], references: [billingInvoices.id] }),
  assignee: one(users, { fields: [billingCollectionActions.assigneeUserId], references: [users.id], relationName: "billing_collection_assignee" }),
  author:   one(users, { fields: [billingCollectionActions.createdBy], references: [users.id], relationName: "billing_collection_author" }),
}))

export const billingProposalsRelations = relations(billingProposals, ({ one, many }) => ({
  client:     one(clients, { fields: [billingProposals.clientId], references: [clients.id] }),
  contract:   one(contracts, { fields: [billingProposals.contractId], references: [contracts.id] }),
  worksite:   one(worksites, { fields: [billingProposals.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [billingProposals.costCenterId], references: [costCenters.id] }),
  owner:      one(users, { fields: [billingProposals.ownerUserId], references: [users.id], relationName: "billing_proposal_owner" }),
  approver:   one(users, { fields: [billingProposals.approvedBy], references: [users.id], relationName: "billing_proposal_approver" }),
  items:      many(billingProposalItems),
}))

export const billingProposalItemsRelations = relations(billingProposalItems, ({ one }) => ({
  proposal: one(billingProposals, { fields: [billingProposalItems.proposalId], references: [billingProposals.id] }),
}))

export const billingSyncRunsRelations = relations(billingSyncRuns, ({ one }) => ({
  triggeredByUser: one(users, { fields: [billingSyncRuns.triggeredBy], references: [users.id] }),
}))

export const billingInvoiceEventsRelations = relations(billingInvoiceEvents, ({ one }) => ({
  invoice: one(billingInvoices, { fields: [billingInvoiceEvents.invoiceId], references: [billingInvoices.id] }),
  actor:   one(users, { fields: [billingInvoiceEvents.actorUserId], references: [users.id] }),
}))

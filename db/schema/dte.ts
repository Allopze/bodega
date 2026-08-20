import { relations, sql } from "drizzle-orm"
import { pgTable, text, integer, numeric, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { purchaseOrderInvoices } from "./purchasing"
import { fuelLoads } from "./fuel-invoices"
import { users } from "./users"

/* ── DTE Sync Run States ─────────────────────────────────────────────────── */
// running | success | partial | failed
// reconciliation: not_run | success | partial | failed

/* ── DTE Document SII States ─────────────────────────────────────────────── */
// pendiente_envio | enviado | aceptado | rechazado | anulado | manual

/* ── DTE Document Intercambio States ─────────────────────────────────────── */
// pendiente | aceptado | rechazado

/* ── DTE Sync Runs (corrida de sincronización) ───────────────────────────── */

/**
 * Registro de cada corrida de sincronización con el portal DTE FacturaEnLinea.
 * Patrón: backupLog + fuelImportBatches.
 *
 * Cada corrida abarca un período y empresa, registra cuántas filas se vieron
 * e insertaron, y su resultado final.
 */
export const dteSyncRuns = pgTable("dte_sync_runs", {
  id:            text("id").primaryKey(),
  periodo:       text("periodo").notNull(),                        // "2026-08"
  codEmp:        text("cod_emp").notNull(),                        // Código interno de empresa en el portal
  trigger:       text("trigger").notNull().$type<"manual" | "cron">().default("manual"),
  status:        text("status").notNull().$type<"running" | "success" | "partial" | "failed">().default("running"),
  rowsSeen:      integer("rows_seen").notNull().default(0),
  rowsInserted:  integer("rows_inserted").notNull().default(0),
  rowsUpdated:   integer("rows_updated").notNull().default(0),
  /** Usuario técnico resuelto para la corrida (sesión del botón manual, o DTE_SYNC_IMPORTER_EMAIL en cron) */
  importerId:    text("importer_id").references(() => users.id),
  /** Batch ID shared by the current/prior periods of one automatic invocation. */
  correlationId: text("correlation_id"),
  error:         text("error"),
  /** Estado de conciliación separado de la ingesta del portal. */
  reconciliationStatus: text("reconciliation_status").notNull()
    .$type<"not_run" | "success" | "partial" | "failed">().default("not_run"),
  /** Resumen redactado de diferencias/ambigüedades o fallo técnico. */
  reconciliationError: text("reconciliation_error"),
  startedAt:     timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt:    timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("dte_sync_runs_trigger_valid", sql`${table.trigger} IN ('manual', 'cron')`),
  check("dte_sync_runs_status_valid", sql`${table.status} IN ('running', 'success', 'partial', 'failed')`),
  check("dte_sync_runs_reconciliation_status_valid", sql`${table.reconciliationStatus} IN ('not_run', 'success', 'partial', 'failed')`),
  index("dte_sync_runs_periodo_idx").on(table.periodo),
  index("dte_sync_runs_status_idx").on(table.status),
  index("dte_sync_runs_reconciliation_status_idx").on(table.reconciliationStatus),
  index("dte_sync_runs_started_idx").on(table.startedAt),
  index("dte_sync_runs_correlation_idx").on(table.correlationId),
  // Una sola corrida `running` por (empresa, período): el cron y el botón de
  // administración disparándose a la vez raspaban el portal dos veces y la
  // segunda contabilizaba fallos falsos al chocar con `dte_documents_unique_key`.
  // Mismo patrón que `billing_sync_runs_single_active_unique` (H-10,
  // AUDITORIA_BUGS_2026-08-05.md).
  uniqueIndex("dte_sync_runs_single_active_unique")
    .on(table.codEmp, table.periodo)
    .where(sql`${table.status} = 'running'`),
])

/* ── DTE Portal Operation Leases ────────────────────────────────────────── */

/**
 * Short-lived proof that a request carrying DTE credentials may be on the
 * wire. Unlike a historical sync row, this lease covers every client request
 * (purchases, sales XML/PDF, and health checks) and expires conservatively if
 * the process dies before it can release it.
 */
export const dtePortalOperationLeases = pgTable("dte_portal_operation_leases", {
  id:             text("id").primaryKey(),
  operation:      text("operation").notNull(),
  startedAt:      timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("dte_portal_operation_leases_expiry_idx").on(table.leaseExpiresAt),
])

/* ── DTE Documents (documentos tributarios sincronizados) ─────────────────── */

/**
 * Documento tributario electrónico obtenido del portal DTE FacturaEnLinea.
 *
 * Clave única: (tipoDte, folio, rutEmisor, codEmp). El folio NO es
 * globalmente único: la serie 12715 puede ser una Factura 33 y una NC 61
 * simultáneamente.
 *
 * Los montos usan numeric para evitar errores de redondeo en CLP.
 */
export const dteDocuments = pgTable("dte_documents", {
  id:                     text("id").primaryKey(),

  /** Tipo de documento SII: 33, 34, 61, 56, 52, etc. */
  tipoDte:                text("tipo_dte").notNull(),
  /** Número de folio del documento */
  folio:                  integer("folio").notNull(),
  /** RUT del emisor del documento (ej: "78023530-6") */
  rutEmisor:              text("rut_emisor").notNull(),
  /** Razón social del emisor */
  razonSocialEmisor:      text("razon_social_emisor").notNull(),
  /** Fecha de emisión en formato YYYY-MM-DD */
  fechaEmision:           text("fecha_emision").notNull(),
  /**
   * Fecha en que el proveedor subió el DTE al portal (YYYY-MM-DD) — nullable:
   * los documentos sincronizados antes de esta columna no la tienen, y la
   * bandeja puede traer la celda ilegible. Es lo que permite medir el atraso
   * del proveedor: la consulta al portal filtra por fecha del DOCUMENTO.
   */
  fechaRecepcion:         text("fecha_recepcion"),

  /** Monto neto ($ CLP). Puede ser negativo en NC. */
  montoNeto:              numeric("monto_neto", { precision: 14, scale: 2, mode: "number" }),
  /** IVA ($ CLP) */
  iva:                    numeric("iva", { precision: 14, scale: 2, mode: "number" }),
  /** Monto total ($ CLP). Puede ser negativo en NC. */
  montoTotal:             numeric("monto_total", { precision: 14, scale: 2, mode: "number" }).notNull(),

  /** Estado en el SII (columna "Aceptación SII" del panel) */
  estadoSii:              text("estado_sii").$type<"pendiente_envio" | "enviado" | "aceptado" | "rechazado" | "anulado" | "manual">(),
  /** Estado de intercambio electrónico (flag_*.png) */
  estadoIntercambio:      text("estado_intercambio").$type<"pendiente" | "aceptado" | "rechazado">(),
  /** Estado textual del documento en la plataforma */
  estadoPlataforma:       text("estado_plataforma"),

  /** Código de empresa del portal (ej: "433") */
  codEmp:                 text("cod_emp").notNull(),
  /** Período de sincronización YYYY-MM */
  periodo:                text("periodo").notNull(),

  /** Ruta al archivo XML descargado (relativa a storage/) — nullable, se llena on-demand */
  xmlPath:                text("xml_path"),
  /** Ruta al archivo PDF descargado (relativa a storage/) — nullable, se llena on-demand */
  pdfPath:                text("pdf_path"),
  /** Id Nreguist del portal, necesario para reconstruir el enlace PDF autenticado. */
  portalRecordId:         text("portal_record_id"),

  /** SHA-256 del contenido clave para deduplicación (tipoDte+folio+rutEmisor+montoTotal+fecha) */
  rawHash:                text("raw_hash").notNull(),

  /** FK a purchaseOrderInvoices — si se pudo conciliar con una factura de OC */
  purchaseOrderInvoiceId: text("purchase_order_invoice_id").references(() => purchaseOrderInvoices.id),
  /** FK a fuelLoads — si se pudo conciliar con una carga de combustible */
  fuelLoadId:             text("fuel_load_id").references(() => fuelLoads.id),
  /** FK a la corrida de sync que creó este registro */
  syncRunId:              text("sync_run_id").references(() => dteSyncRuns.id),

  syncedAt:               timestamp("synced_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt:              timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // El folio no es único global: la clave compuesta evita duplicados de misma serie+tipo+emisor+empresa
  uniqueIndex("dte_documents_unique_key").on(table.tipoDte, table.folio, table.rutEmisor, table.codEmp),
  check("dte_documents_estado_sii_valid", sql`
    ${table.estadoSii} IS NULL OR ${table.estadoSii} IN (
      'pendiente_envio', 'enviado', 'aceptado', 'rechazado', 'anulado', 'manual'
    )
  `),
  check("dte_documents_estado_intercambio_valid", sql`
    ${table.estadoIntercambio} IS NULL OR ${table.estadoIntercambio} IN (
      'pendiente', 'aceptado', 'rechazado'
    )
  `),
  // Un DTE representa una sola evidencia tributaria: nunca puede quedar
  // simultáneamente conciliado contra una factura de OC y una carga TAE.
  check("dte_documents_single_business_link", sql`
    ${table.purchaseOrderInvoiceId} IS NULL OR ${table.fuelLoadId} IS NULL
  `),
  // Una factura de OC sólo puede conservar un DTE. El índice es la última
  // barrera frente a carreras entre conciliación automática y vínculo manual.
  uniqueIndex("dte_documents_purchase_invoice_single_unique")
    .on(table.purchaseOrderInvoiceId)
    .where(sql`${table.purchaseOrderInvoiceId} IS NOT NULL`),
  // Simétrico del anterior: una carga de combustible tampoco puede quedar con
  // dos documentos tributarios encima (un 33 y un 34 del mismo emisor comparten
  // rangos de folio, y basta que caigan en períodos distintos).
  uniqueIndex("dte_documents_fuel_load_single_unique")
    .on(table.fuelLoadId)
    .where(sql`${table.fuelLoadId} IS NOT NULL`),
  index("dte_documents_periodo_idx").on(table.periodo),
  index("dte_documents_estado_sii_idx").on(table.estadoSii),
  index("dte_documents_rut_emisor_idx").on(table.rutEmisor),
  index("dte_documents_purchase_invoice_idx").on(table.purchaseOrderInvoiceId),
  index("dte_documents_fuel_load_idx").on(table.fuelLoadId),
  index("dte_documents_portal_record_idx").on(table.portalRecordId),
  index("dte_documents_raw_hash_idx").on(table.rawHash),
  index("dte_documents_sync_run_idx").on(table.syncRunId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */

export const dteDocumentsRelations = relations(dteDocuments, ({ one }) => ({
  purchaseOrderInvoice: one(purchaseOrderInvoices, {
    fields: [dteDocuments.purchaseOrderInvoiceId],
    references: [purchaseOrderInvoices.id],
  }),
  fuelLoad: one(fuelLoads, {
    fields: [dteDocuments.fuelLoadId],
    references: [fuelLoads.id],
  }),
  syncRun: one(dteSyncRuns, {
    fields: [dteDocuments.syncRunId],
    references: [dteSyncRuns.id],
  }),
}))

export const dteSyncRunsRelations = relations(dteSyncRuns, ({ many }) => ({
  documents: many(dteDocuments),
}))

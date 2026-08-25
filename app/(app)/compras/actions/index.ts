// ── Order creation ───────────────────────────────────────────────────────────
export { createOrderAction } from "./create-order"

// ── Order lifecycle (status progression) ─────────────────────────────────────
export { issueAndSendOrderAction } from "./order-status"

// ── Registro posterior del costo (servicios con costo pendiente) ─────────────
export { recordItemCostAction } from "./item-cost"

// ── Conciliación administrativa OC ↔ facturas ───────────────────────────────
export { acceptInvoiceReconciliationAction } from "./invoice-reconciliation"

// ── Order termination ────────────────────────────────────────────────────────
export { closeOrderAction, cancelOrderAction, deleteOrderAction } from "./order-cancel"

// ── DTE (portal DTE FacturaEnLínea, Bandeja de Entrada) ───────────────────────
export { downloadDteDocumentXml } from "./dte-download-xml"
export type { DteXmlDownloadResult } from "./dte-download-xml"
export type { DteXmlDetail } from "@/lib/services/dte-portal/purchase-document-xml"
export { attachDteAsInvoice } from "./dte-use-invoice"

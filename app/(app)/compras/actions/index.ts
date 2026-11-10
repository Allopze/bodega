// ── Order creation ───────────────────────────────────────────────────────────
export { createOrderAction } from "./create-order"

// ── Order lifecycle (status progression) ─────────────────────────────────────
export { issueAndSendOrderAction } from "./order-status"

// ── Registro posterior del costo (servicios con costo pendiente) ─────────────
export { recordItemCostAction } from "./item-cost"

// ── Conciliación administrativa OC ↔ facturas ───────────────────────────────
export { acceptInvoiceReconciliationAction } from "./invoice-reconciliation"

// ── Catalogar al comprar (vincular o crear un repuesto desde la línea de la OC) ─
export { searchSparePartsForOcAction, linkSparePartForOcAction, createSparePartForOcAction, unlinkSparePartForOcAction } from "./spare-part-link"
export type { SparePartChoice, SearchSparePartsResult, SparePartLinkResult, SparePartUnlinkResult } from "./spare-part-link"

// ── Order termination ────────────────────────────────────────────────────────
export { closeOrderAction, cancelOrderAction, deleteOrderAction } from "./order-cancel"

// ── DTE (portal DTE FacturaEnLínea, Bandeja de Entrada) ───────────────────────
export { downloadDteDocumentXml } from "./dte-download-xml"
export type { DteXmlDownloadResult } from "./dte-download-xml"
export type { DteXmlDetail } from "@/lib/services/dte-portal/purchase-document-xml"
export { attachDteAsInvoice } from "./dte-use-invoice"

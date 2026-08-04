/**
 * lib/services/dte-portal/reconciliation.ts
 *
 * Conciliación de documentos DTE sincronizados contra datos internos:
 * - purchaseOrderInvoices (facturas de OC)
 * - fuelLoads (cargas de combustible)
 *
 * Detecta facturas huérfanas, discrepancias de monto y NC sin aplicar.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § Plan de Implementación, Fase 3
 */

import { eq, and, isNull, sql, inArray } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"

// ── Tipos de resultado ──────────────────────────────────────────────────────

export interface DteReconciliationMatch {
  dteDocumentId: string
  matchedEntityId: string
  matchType: "purchase_order_invoice" | "fuel_load"
  dteTotal: number
  entityTotal: number
  discrepancy: number
  discrepancyPercent: number
}

export interface DteHealthStats {
  periodo: string
  totalDocuments: number
  estadoSii: {
    aceptado: number
    pendienteEnvio: number
    enviado: number
    rechazado: number
    anulado: number
    manual: number
    sinEstado: number
  }
  reconciliation: {
    matchedToOc: number
    matchedToFuel: number
    unmatched: number
    discrepancies: number
  }
  creditNotes: {
    total: number
    applied: number
    pending: number
  }
}

// ── Conciliación con facturas de OC ─────────────────────────────────────────

/**
 * Intenta vincular documentos DTE sin match con facturas de OC.
 *
 * Estrategia: cruza por (folio → invoiceNumber). El RUT emisor debería
 * coincidir con el supplier de la OC, pero el portal no siempre expone
 * el RUT en el HTML de la tabla, así que el cruce por folio + tipo es
 * el match primario.
 *
 * @returns Cantidad de documentos nuevamente vinculados.
 */
export async function matchToPurchaseOrderInvoices(
  periodo: string,
  codEmp: string,
): Promise<DteReconciliationMatch[]> {
  const matches: DteReconciliationMatch[] = []

  // Obtener documentos DTE del período sin vínculo a OC
  const unmatchedDocs = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.periodo, periodo),
      eq(dteDocuments.codEmp, codEmp),
      isNull(dteDocuments.purchaseOrderInvoiceId),
      // Solo facturas y NC (33, 34, 61, 56), no guías ni boletas
      sql`${dteDocuments.tipoDte} IN ('33', '34', '61', '56')`,
    ),
    columns: {
      id: true,
      tipoDte: true,
      folio: true,
      rutEmisor: true,
      montoTotal: true,
    },
  })

  if (unmatchedDocs.length === 0) return matches

  // Buscar invoices que coincidan por folio
  const folios = unmatchedDocs.map((d) => String(d.folio))

  const invoices = await db.query.purchaseOrderInvoices.findMany({
    where: inArray(purchaseOrderInvoices.invoiceNumber, folios),
    columns: {
      id: true,
      invoiceNumber: true,
      amount: true,
      purchaseOrderId: true,
    },
  })

  // Crear mapa de folio → invoice para match rápido
  const invoiceByFolio = new Map(invoices.map((inv) => [inv.invoiceNumber, inv]))

  for (const doc of unmatchedDocs) {
    const invoice = invoiceByFolio.get(String(doc.folio))
    if (!invoice) continue

    const dteTotal = doc.montoTotal ?? 0
    const entityTotal = invoice.amount ?? 0
    const discrepancy = Math.abs(dteTotal - entityTotal)
    const discrepancyPercent = entityTotal !== 0
      ? (discrepancy / Math.abs(entityTotal)) * 100
      : (discrepancy > 0 ? 100 : 0)

    // Vincular el DTE con la factura de OC
    await db.update(dteDocuments).set({
      purchaseOrderInvoiceId: invoice.id,
    }).where(eq(dteDocuments.id, doc.id))

    matches.push({
      dteDocumentId: doc.id,
      matchedEntityId: invoice.id,
      matchType: "purchase_order_invoice",
      dteTotal,
      entityTotal,
      discrepancy,
      discrepancyPercent,
    })
  }

  return matches
}

// ── Conciliación con cargas de combustible ───────────────────────────────────

/**
 * Intenta vincular documentos DTE con cargas de combustible.
 *
 * Cruza por folio → fuelLoads.receiptNumber.
 *
 * @returns Cantidad de documentos nuevamente vinculados.
 */
export async function matchToFuelLoads(
  periodo: string,
  codEmp: string,
): Promise<DteReconciliationMatch[]> {
  const matches: DteReconciliationMatch[] = []

  // Documentos DTE sin vínculo a fuel load
  const unmatchedDocs = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.periodo, periodo),
      eq(dteDocuments.codEmp, codEmp),
      isNull(dteDocuments.fuelLoadId),
      sql`${dteDocuments.tipoDte} IN ('33', '34', '61', '56')`,
    ),
    columns: {
      id: true,
      tipoDte: true,
      folio: true,
      rutEmisor: true,
      montoTotal: true,
    },
  })

  if (unmatchedDocs.length === 0) return matches

  const folios = unmatchedDocs.map((d) => String(d.folio))

  // Buscar cargas por receiptNumber
  const loads = await db.query.fuelLoads.findMany({
    where: inArray(fuelLoads.receiptNumber, folios),
    columns: {
      id: true,
      receiptNumber: true,
      totalAmount: true,
    },
  })

  const loadByReceipt = new Map(
    loads.filter((l) => l.receiptNumber).map((l) => [l.receiptNumber!, l]),
  )

  for (const doc of unmatchedDocs) {
    const load = loadByReceipt.get(String(doc.folio))
    if (!load) continue

    const dteTotal = doc.montoTotal ?? 0
    const entityTotal = load.totalAmount ?? 0
    const discrepancy = Math.abs(dteTotal - entityTotal)
    const discrepancyPercent = entityTotal !== 0
      ? (discrepancy / Math.abs(entityTotal)) * 100
      : (discrepancy > 0 ? 100 : 0)

    await db.update(dteDocuments).set({
      fuelLoadId: load.id,
    }).where(eq(dteDocuments.id, doc.id))

    matches.push({
      dteDocumentId: doc.id,
      matchedEntityId: load.id,
      matchType: "fuel_load",
      dteTotal,
      entityTotal,
      discrepancy,
      discrepancyPercent,
    })
  }

  return matches
}

// ── Estadísticas de salud tributaria ─────────────────────────────────────────

/**
 * Calcula estadísticas de salud tributaria para un período.
 * Alimenta los indicadores del dashboard.
 */
export async function computeHealthStats(
  periodo: string,
  codEmp: string,
): Promise<DteHealthStats> {
  const docs = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.periodo, periodo),
      eq(dteDocuments.codEmp, codEmp),
    ),
    columns: {
      id: true,
      tipoDte: true,
      estadoSii: true,
      purchaseOrderInvoiceId: true,
      fuelLoadId: true,
      montoTotal: true,
    },
  })

  const totalDocuments = docs.length

  // Estados SII
  const estadoSii = {
    aceptado: 0,
    pendienteEnvio: 0,
    enviado: 0,
    rechazado: 0,
    anulado: 0,
    manual: 0,
    sinEstado: 0,
  }
  for (const doc of docs) {
    switch (doc.estadoSii) {
      case "aceptado": estadoSii.aceptado++; break
      case "pendiente_envio": estadoSii.pendienteEnvio++; break
      case "enviado": estadoSii.enviado++; break
      case "rechazado": estadoSii.rechazado++; break
      case "anulado": estadoSii.anulado++; break
      case "manual": estadoSii.manual++; break
      default: estadoSii.sinEstado++; break
    }
  }

  // Reconciliación
  const matchedToOc = docs.filter((d) => d.purchaseOrderInvoiceId).length
  const matchedToFuel = docs.filter((d) => d.fuelLoadId).length
  const unmatched = docs.filter((d) => !d.purchaseOrderInvoiceId && !d.fuelLoadId).length

  // Discrepancias: documentos con vínculo pero montos que difieren
  // (esto se calcula en detalle en los reportes, aquí solo el conteo)
  const discrepancies = 0 // TODO: calcular contra purchaseOrderInvoices.amount

  // Notas de crédito
  const creditNotes = docs.filter((d) => d.tipoDte === "61")
  const appliedCreditNotes = creditNotes.filter(
    (d) => d.purchaseOrderInvoiceId || d.fuelLoadId,
  )

  return {
    periodo,
    totalDocuments,
    estadoSii,
    reconciliation: {
      matchedToOc,
      matchedToFuel,
      unmatched,
      discrepancies,
    },
    creditNotes: {
      total: creditNotes.length,
      applied: appliedCreditNotes.length,
      pending: creditNotes.length - appliedCreditNotes.length,
    },
  }
}

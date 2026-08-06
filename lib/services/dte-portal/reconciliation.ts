/**
 * lib/services/dte-portal/reconciliation.ts
 *
 * Conciliación de documentos DTE sincronizados contra datos internos:
 * - purchaseOrderInvoices (facturas de OC)
 * - fuelLoads (cargas de combustible)
 *
 * Detecta facturas huérfanas, discrepancias de monto y NC sin aplicar.
 *
 * @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7
 */

import { eq, and, isNull, sql, inArray } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"
import { cleanRut } from "@/lib/rut"

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
 * Estrategia: cruza por (folio Y RUT emisor). El folio NO es único global
 * — dos proveedores distintos pueden compartir numeración — así que cruzar
 * solo por folio (como se hacía antes) podía vincular una factura con el
 * proveedor equivocado. El RUT del proveedor de la OC se obtiene vía
 * purchaseOrderInvoices → purchaseOrders → suppliers.rut (no hay FK directo
 * proveedor↔factura). Los RUT se normalizan con cleanRut() antes de
 * comparar — el ingresado a mano en `suppliers.rut` no siempre tiene el
 * mismo formato (puntos, mayúsculas) que el que trae el portal.
 *
 * @returns Documentos nuevamente vinculados.
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
      // Solo facturas (33, 34): el folio de una NC/ND (61, 56) viene de una
      // secuencia SII independiente, así que su igualdad numérica con el
      // invoiceNumber de una OC es coincidencia, no identidad — auto-vincular
      // ahí colgaba la NC de una factura ajena. NC/ND quedan para vínculo manual.
      sql`${dteDocuments.tipoDte} IN ('33', '34')`,
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

  // Buscar invoices que coincidan por folio, trayendo el RUT del proveedor
  // de la OC en la misma consulta (join vía la relación purchaseOrder→supplier).
  const folios = unmatchedDocs.map((d) => String(d.folio))

  const invoices = await db.query.purchaseOrderInvoices.findMany({
    where: inArray(purchaseOrderInvoices.invoiceNumber, folios),
    columns: {
      id: true,
      invoiceNumber: true,
      amount: true,
      purchaseOrderId: true,
    },
    with: {
      purchaseOrder: {
        columns: {},
        with: { supplier: { columns: { rut: true } } },
      },
    },
  })

  // Mapa (folio|RUT normalizado) → invoice, para exigir ambos en el match.
  const invoiceByFolioAndRut = new Map<string, (typeof invoices)[number]>()
  for (const inv of invoices) {
    const rut = inv.purchaseOrder?.supplier?.rut
    if (!rut) continue
    invoiceByFolioAndRut.set(`${inv.invoiceNumber}|${cleanRut(rut)}`, inv)
  }

  for (const doc of unmatchedDocs) {
    const invoice = invoiceByFolioAndRut.get(`${doc.folio}|${cleanRut(doc.rutEmisor)}`)
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
 * Cruza por (folio → receiptNumber) Y RUT emisor (vía fuelLoads.fuelSupplierId
 * → fuelSuppliers.rut — acá sí hay FK directo, a diferencia de OC). Mismo
 * motivo que en matchToPurchaseOrderInvoices: el folio no es único global.
 *
 * @returns Documentos nuevamente vinculados.
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
      // Solo facturas (33, 34): mismo motivo que en matchToPurchaseOrderInvoices
      // — el folio de una NC/ND no comparte secuencia con el receiptNumber.
      sql`${dteDocuments.tipoDte} IN ('33', '34')`,
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

  // Buscar cargas por receiptNumber, trayendo el RUT del proveedor de combustible.
  const loads = await db.query.fuelLoads.findMany({
    where: inArray(fuelLoads.receiptNumber, folios),
    columns: {
      id: true,
      receiptNumber: true,
      totalAmount: true,
    },
    with: { supplier: { columns: { rut: true } } },
  })

  const loadByReceiptAndRut = new Map<string, (typeof loads)[number]>()
  for (const load of loads) {
    if (!load.receiptNumber || !load.supplier?.rut) continue
    loadByReceiptAndRut.set(`${load.receiptNumber}|${cleanRut(load.supplier.rut)}`, load)
  }

  for (const doc of unmatchedDocs) {
    const load = loadByReceiptAndRut.get(`${doc.folio}|${cleanRut(doc.rutEmisor)}`)
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

  // Discrepancias: documentos con vínculo cuyo monto difiere del de la
  // entidad vinculada (factura de OC o carga de combustible).
  const discrepancies = await countDiscrepancies(docs)

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

/** Diferencia mínima (CLP) para considerar dos montos "distintos" — evita falsos positivos por redondeo. */
const DISCREPANCY_TOLERANCE_CLP = 1

/**
 * Cuenta documentos vinculados (a OC o a combustible) cuyo monto difiere del
 * de la entidad vinculada en más de DISCREPANCY_TOLERANCE_CLP. Recalcula
 * contra el monto ACTUAL de la entidad — no reutiliza el discrepancyPercent
 * calculado al momento del match (matchTo*), que no se persiste.
 */
async function countDiscrepancies(
  docs: Array<{ purchaseOrderInvoiceId: string | null; fuelLoadId: string | null; montoTotal: number }>,
): Promise<number> {
  const ocIds = docs.flatMap((d) => (d.purchaseOrderInvoiceId ? [d.purchaseOrderInvoiceId] : []))
  const fuelIds = docs.flatMap((d) => (d.fuelLoadId ? [d.fuelLoadId] : []))

  const [invoices, loads] = await Promise.all([
    ocIds.length > 0
      ? db.query.purchaseOrderInvoices.findMany({ where: inArray(purchaseOrderInvoices.id, ocIds), columns: { id: true, amount: true } })
      : Promise.resolve([]),
    fuelIds.length > 0
      ? db.query.fuelLoads.findMany({ where: inArray(fuelLoads.id, fuelIds), columns: { id: true, totalAmount: true } })
      : Promise.resolve([]),
  ])

  const invoiceAmountById = new Map(invoices.map((i) => [i.id, i.amount ?? 0]))
  const loadAmountById = new Map(loads.map((l) => [l.id, l.totalAmount ?? 0]))

  let count = 0
  for (const doc of docs) {
    const entityTotal = doc.purchaseOrderInvoiceId
      ? invoiceAmountById.get(doc.purchaseOrderInvoiceId)
      : doc.fuelLoadId
        ? loadAmountById.get(doc.fuelLoadId)
        : undefined
    if (entityTotal === undefined) continue
    if (Math.abs((doc.montoTotal ?? 0) - entityTotal) > DISCREPANCY_TOLERANCE_CLP) count++
  }
  return count
}

/**
 * Notas de crédito (tipo 61) emitidas por un proveedor de combustible que aún
 * no se vincularon a ninguna carga. A diferencia de `creditNotes.pending` de
 * `computeHealthStats` (que mezcla NC de cualquier dominio sin vínculo), esto
 * exige que el RUT emisor pertenezca a `fuelSuppliers` — la única forma
 * honesta de mostrar "NC de combustible" en el Dashboard sin conflar dominios.
 */
export async function countPendingFuelCreditNotes(periodo: string, codEmp: string): Promise<number> {
  const notes = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.periodo, periodo),
      eq(dteDocuments.codEmp, codEmp),
      eq(dteDocuments.tipoDte, "61"),
      isNull(dteDocuments.fuelLoadId),
    ),
    columns: { rutEmisor: true },
  })
  if (notes.length === 0) return 0

  // inArray() exige coincidencia literal — igual que en el resto de este
  // archivo, el RUT guardado en fuelSuppliers puede llevar puntos/mayúsculas
  // distintas al del portal, así que se compara en memoria tras normalizar.
  const suppliers = await db.query.fuelSuppliers.findMany({ columns: { rut: true } })
  const fuelSupplierRuts = new Set(suppliers.flatMap((s) => (s.rut ? [cleanRut(s.rut)] : [])))

  return notes.filter((n) => fuelSupplierRuts.has(cleanRut(n.rutEmisor))).length
}

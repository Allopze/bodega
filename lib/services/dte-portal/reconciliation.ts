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
import { logger } from "@/lib/logger"
import { normalizeFolio, folioRutKey } from "./folio-match"

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
  //
  // El folio del DTE es un entero; `invoiceNumber` lo tipea una persona. Se
  // compara por la forma normalizada (sólo dígitos, sin ceros a la izquierda),
  // así que "0045678", "45.678" y "F-45678" cruzan con el folio 45678 — antes
  // ninguna de las tres lo hacía y el documento quedaba sin vincular sin decir
  // por qué. El SQL es sólo un prefiltro: la comparación que decide es la de
  // `normalizeFolio` unas líneas más abajo.
  const folios = [...new Set(unmatchedDocs.map((d) => normalizeFolio(d.folio)).filter(Boolean))]
  if (folios.length === 0) return matches

  const invoices = await db.query.purchaseOrderInvoices.findMany({
    where: sql`ltrim(regexp_replace(coalesce(${purchaseOrderInvoices.invoiceNumber}, ''), '[^0-9]', '', 'g'), '0') IN ${folios}`,
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

  // Mapa (folio normalizado|RUT normalizado) → invoice, para exigir ambos.
  //
  // Si dos facturas del MISMO proveedor normalizan al mismo folio, no se elige
  // una: se descarta el par. Es un dato inconsistente del lado interno (la
  // misma factura cargada dos veces, o un número mal tipeado) y adivinar cuál
  // vale vincularía el documento tributario a la compra equivocada.
  const invoiceByFolioAndRut = new Map<string, (typeof invoices)[number]>()
  const ambiguous = new Set<string>()
  for (const inv of invoices) {
    const rut = inv.purchaseOrder?.supplier?.rut
    if (!rut) continue
    const key = folioRutKey(inv.invoiceNumber, cleanRut(rut))
    if (!key.startsWith("|") && invoiceByFolioAndRut.has(key)) {
      ambiguous.add(key)
      continue
    }
    invoiceByFolioAndRut.set(key, inv)
  }
  for (const key of ambiguous) {
    invoiceByFolioAndRut.delete(key)
    logger.warn("[dte-reconciliation] coincidencia ambigua", { code: "DTE_RECONCILIATION_AMBIGUOUS_PURCHASE_ORDER" })
  }

  for (const doc of unmatchedDocs) {
    const invoice = invoiceByFolioAndRut.get(folioRutKey(doc.folio, cleanRut(doc.rutEmisor)))
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

/**
 * Cruce en la dirección inversa: una factura recién registrada contra los DTE
 * que ya llegaron y siguen sin vincular.
 *
 * ## Por qué hace falta
 *
 * `matchToPurchaseOrderInvoices` corre **sólo durante la sincronización** y
 * acotado al período que se está sincronizando. Eso deja un hueco temporal
 * completo: si el DTE llega antes de que alguien registre la factura —el caso
 * normal, porque el proveedor emite y después Compras carga— el cruce ya pasó y
 * no vuelve a intentarlo. Con la ventana móvil del cron el DTE se re-evalúa
 * mientras el período siga abierto, pero un período cerrado no vuelve nunca.
 *
 * Se llama al registrar la factura, y su fallo no debe voltear el registro: la
 * factura ya está guardada y el vínculo es un enriquecimiento, no un requisito.
 *
 * @returns El vínculo creado, o `null` si no hubo coincidencia inequívoca.
 */
export async function matchInvoiceToDteDocument(
  invoiceId: string,
): Promise<DteReconciliationMatch | null> {
  const invoice = await db.query.purchaseOrderInvoices.findFirst({
    where: eq(purchaseOrderInvoices.id, invoiceId),
    columns: { id: true, invoiceNumber: true, amount: true },
    with: {
      purchaseOrder: {
        columns: {},
        with: { supplier: { columns: { rut: true } } },
      },
    },
  })
  if (!invoice) return null

  const supplierRut = invoice.purchaseOrder?.supplier?.rut
  if (!supplierRut) return null

  // El folio del DTE es un entero, así que su forma normalizada es su propio
  // valor: se compara numéricamente y se aprovecha `dte_documents_rut_emisor_idx`
  // en vez de aplicar una regexp sobre toda la tabla.
  const normalized = normalizeFolio(invoice.invoiceNumber)
  if (!normalized) return null
  const folio = Number(normalized)
  if (!Number.isSafeInteger(folio)) return null

  const candidates = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.folio, folio),
      isNull(dteDocuments.purchaseOrderInvoiceId),
      inArray(dteDocuments.tipoDte, ["33", "34"]),
    ),
    columns: { id: true, folio: true, rutEmisor: true, montoTotal: true },
  })

  const cleaned = cleanRut(supplierRut)
  const matching = candidates.filter((doc) => cleanRut(doc.rutEmisor) === cleaned)

  // Más de un DTE sin vincular con el mismo folio y proveedor es un dato
  // inconsistente del portal; elegir uno colgaría el documento equivocado.
  if (matching.length !== 1) {
    if (matching.length > 1) {
      logger.warn("[dte-reconciliation] coincidencia ambigua", { code: "DTE_RECONCILIATION_AMBIGUOUS_DOCUMENT", matches: matching.length })
    }
    return null
  }

  const doc = matching[0]!
  const dteTotal = doc.montoTotal ?? 0
  const entityTotal = invoice.amount ?? 0
  const discrepancy = Math.abs(dteTotal - entityTotal)

  await db.update(dteDocuments)
    .set({ purchaseOrderInvoiceId: invoice.id })
    .where(eq(dteDocuments.id, doc.id))

  return {
    dteDocumentId: doc.id,
    matchedEntityId: invoice.id,
    matchType: "purchase_order_invoice",
    dteTotal,
    entityTotal,
    discrepancy,
    discrepancyPercent: entityTotal !== 0
      ? (discrepancy / Math.abs(entityTotal)) * 100
      : (discrepancy > 0 ? 100 : 0),
  }
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

  // `receiptNumber` también lo tipea una persona: se normaliza igual que el
  // número de factura de OC (ver folio-match.ts).
  const folios = [...new Set(unmatchedDocs.map((d) => normalizeFolio(d.folio)).filter(Boolean))]
  if (folios.length === 0) return matches

  // Buscar cargas por receiptNumber, trayendo el RUT del proveedor de combustible.
  const loads = await db.query.fuelLoads.findMany({
    where: sql`ltrim(regexp_replace(coalesce(${fuelLoads.receiptNumber}, ''), '[^0-9]', '', 'g'), '0') IN ${folios}`,
    columns: {
      id: true,
      receiptNumber: true,
      totalAmount: true,
    },
    with: { supplier: { columns: { rut: true } } },
  })

  const loadByReceiptAndRut = new Map<string, (typeof loads)[number]>()
  const ambiguousLoads = new Set<string>()
  for (const load of loads) {
    if (!load.receiptNumber || !load.supplier?.rut) continue
    const key = folioRutKey(load.receiptNumber, cleanRut(load.supplier.rut))
    if (key.startsWith("|")) continue
    if (loadByReceiptAndRut.has(key)) {
      ambiguousLoads.add(key)
      continue
    }
    loadByReceiptAndRut.set(key, load)
  }
  for (const key of ambiguousLoads) {
    loadByReceiptAndRut.delete(key)
    logger.warn("[dte-reconciliation] coincidencia ambigua", { code: "DTE_RECONCILIATION_AMBIGUOUS_FUEL_LOAD" })
  }

  for (const doc of unmatchedDocs) {
    const load = loadByReceiptAndRut.get(folioRutKey(doc.folio, cleanRut(doc.rutEmisor)))
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

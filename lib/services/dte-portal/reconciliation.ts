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

import { eq, and, isNull, sql, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"
import { cleanRut } from "@/lib/rut"
import { logger } from "@/lib/logger"
import { localDateToISO } from "@/lib/sst/date"
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

export interface DteReconciliationSummary {
  matched: number
  ambiguous: number
  /** Documentos sin vínculo que todavía pueden conciliarse. */
  unmatched: number
  /**
   * Documentos que el modelo 1:1 no puede vincular porque el dato interno es
   * legítimamente múltiple: una factura TAE mensual cubre N cargas y todas
   * comparten `receiptNumber` (ver lib/combustibles/import.ts). No es un
   * pendiente de conciliación, así que no se cuenta como `unmatched` ni deja la
   * corrida en `partial` para siempre.
   */
  internalAmbiguity: number
  discrepancies: number
}

/** Diferencia máxima (CLP) para vincular automáticamente sin intervención humana. */
const AUTO_MATCH_AMOUNT_TOLERANCE_CLP = 1

/**
 * `estado_plataforma` es texto libre del portal (el `title` de `penplata.gif`),
 * no un enum, así que la única señal disponible es la palabra. Un documento
 * reclamado o bloqueado no da derecho a crédito fiscal: no puede conciliarse
 * solo contra una compra interna, queda para revisión manual.
 *
 * Techo conocido: si el portal estrena otro texto para el mismo hecho, hay que
 * sumarlo a esta lista — no hay forma de derivarlo del HTML.
 */
const BLOCKED_PLATFORM_STATUS = /reclamad|bloquead|rechazad|anulad/i

function isBlockedPlatformStatus(estadoPlataforma: string | null | undefined): boolean {
  return Boolean(estadoPlataforma && BLOCKED_PLATFORM_STATUS.test(estadoPlataforma))
}

/** Los montos deben calzar al peso para vincular sin que nadie lo mire. */
function amountsMatchForAutoLink(dteTotal: number, entityTotal: number): boolean {
  return Math.abs(dteTotal - entityTotal) <= AUTO_MATCH_AMOUNT_TOLERANCE_CLP
}

function uniqueNormalizedFolios(
  documents: readonly { folio: string | number | null | undefined }[],
): string[] {
  const folios = new Set<string>()
  for (const document of documents) {
    const folio = normalizeFolio(document.folio)
    if (folio) folios.add(folio)
  }
  return [...folios]
}

function keysWithMultipleCandidates(counts: ReadonlyMap<string, number>): Set<string> {
  const ambiguous = new Set<string>()
  for (const [key, count] of counts) {
    if (count > 1) ambiguous.add(key)
  }
  return ambiguous
}

/** Resume la etapa posterior a la ingesta sin cambiar ningún vínculo. */
export async function summarizeDteReconciliation(
  periodo: string,
  codEmp: string,
  _matches: DteReconciliationMatch[],
): Promise<DteReconciliationSummary> {
  const eligibleDocs = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.periodo, periodo),
      eq(dteDocuments.codEmp, codEmp),
      sql`${dteDocuments.tipoDte} IN ('33', '34')`,
    ),
    columns: {
      id: true,
      tipoDte: true,
      folio: true,
      rutEmisor: true,
      montoTotal: true,
      purchaseOrderInvoiceId: true,
      fuelLoadId: true,
    },
  })
  const unlinkedDocs = eligibleDocs.filter((doc) => !doc.purchaseOrderInvoiceId && !doc.fuelLoadId)
  const groupedFuelKeys = await fuelKeysWithSeveralLoads(unlinkedDocs)
  const internalAmbiguity = unlinkedDocs.filter(
    (doc) => groupedFuelKeys.has(folioRutKey(doc.folio, cleanRut(doc.rutEmisor))),
  ).length
  const unmatched = unlinkedDocs.length - internalAmbiguity
  const ambiguous = new Map<string, number>()
  for (const doc of eligibleDocs) {
    if (doc.purchaseOrderInvoiceId || doc.fuelLoadId) continue
    const key = `${normalizeFolio(doc.folio)}|${cleanRut(doc.rutEmisor)}`
    ambiguous.set(key, (ambiguous.get(key) ?? 0) + 1)
  }
  const ambiguousDocuments = [...ambiguous.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0)
  const matched = eligibleDocs.filter((doc) => doc.purchaseOrderInvoiceId || doc.fuelLoadId).length
  const discrepancies = await countDiscrepancies(eligibleDocs)
  return {
    matched,
    // Las coincidencias ambiguas se mantienen sin vínculo; contar los DTE
    // afectados hace visible que ambos lados de una colisión 33/34 requieren
    // revisión, no sólo que existe una clave repetida.
    ambiguous: ambiguousDocuments,
    unmatched,
    internalAmbiguity,
    discrepancies,
  }
}

/**
 * Claves (folio|RUT) con más de un DTE sin vincular, mirando TODA la tabla de
 * la empresa y no sólo el período que se sincroniza.
 *
 * Un 33 y un 34 del mismo emisor tienen rangos de folio CAF independientes, así
 * que pueden repetir número y llegar en meses distintos: contando sólo dentro
 * del período, cada corrida creía tener un candidato único y ganaba el que
 * llegara primero — exactamente lo que la regla dice que no debe pasar.
 */
async function ambiguousDocumentKeys(
  periodDocs: readonly { folio: number }[],
  codEmp: string,
): Promise<Set<string>> {
  const folios = [...new Set(periodDocs.map((doc) => doc.folio))]
  if (folios.length === 0) return new Set()

  const siblings = await db.query.dteDocuments.findMany({
    where: and(
      eq(dteDocuments.codEmp, codEmp),
      inArray(dteDocuments.folio, folios),
      isNull(dteDocuments.purchaseOrderInvoiceId),
      isNull(dteDocuments.fuelLoadId),
      inArray(dteDocuments.tipoDte, ["33", "34"]),
    ),
    columns: { id: true, folio: true, rutEmisor: true },
  })

  const counts = new Map<string, number>()
  for (const doc of siblings) {
    const key = folioRutKey(doc.folio, cleanRut(doc.rutEmisor))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return keysWithMultipleCandidates(counts)
}

/**
 * Claves (folio|RUT) que del lado interno corresponden a MÁS DE UNA carga de
 * combustible. Es el caso normal de la importación TAE: una factura mensual con
 * N líneas inserta N cargas con el mismo `receiptNumber`, y el vínculo 1:1 de
 * `dte_documents.fuel_load_id` no puede representarlo.
 */
async function fuelKeysWithSeveralLoads(
  unlinkedDocs: readonly { folio: number; rutEmisor: string }[],
): Promise<Set<string>> {
  const folios = uniqueNormalizedFolios(unlinkedDocs)
  if (folios.length === 0) return new Set()

  const loads = await db.query.fuelLoads.findMany({
    where: sql`ltrim(regexp_replace(coalesce(${fuelLoads.receiptNumber}, ''), '[^0-9]', '', 'g'), '0') IN ${folios}`,
    columns: { id: true, receiptNumber: true },
    with: { supplier: { columns: { rut: true } } },
  })

  const counts = new Map<string, number>()
  for (const load of loads) {
    if (!load.receiptNumber || !load.supplier?.rut) continue
    const key = folioRutKey(load.receiptNumber, cleanRut(load.supplier.rut))
    if (key.startsWith("|")) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return keysWithMultipleCandidates(counts)
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
      isNull(dteDocuments.fuelLoadId),
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
      fechaEmision: true,
      estadoPlataforma: true,
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
  const folios = uniqueNormalizedFolios(unmatchedDocs)
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
        columns: { status: true, deletedAt: true, createdAt: true },
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
    // Una OC anulada o eliminada conserva sus facturas (`deleteOrder` es soft
    // delete), así que sin esto el conciliador consume el documento tributario
    // de una compra viva contra una orden muerta — y desde ahí no se puede
    // reasignar sin SQL.
    if (inv.purchaseOrder.status === "cancelled" || inv.purchaseOrder.deletedAt) continue
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

  // El tipo forma parte de la identidad tributaria, pero NO de la decisión de
  // conciliación: un 33 y un 34 con el mismo folio/RUT son dos candidatos para
  // una sola factura interna y nunca se debe elegir uno por orden de llegada.
  const ambiguousDocuments = await ambiguousDocumentKeys(unmatchedDocs, codEmp)
  for (const key of ambiguousDocuments) {
    logger.warn("[dte-reconciliation] documentos 33/34 ambiguos", {
      code: "DTE_RECONCILIATION_AMBIGUOUS_DOCUMENT_TYPE",
      key,
    })
  }

  for (const doc of unmatchedDocs) {
    const docKey = folioRutKey(doc.folio, cleanRut(doc.rutEmisor))
    if (ambiguousDocuments.has(docKey)) continue
    if (isBlockedPlatformStatus(doc.estadoPlataforma)) {
      logger.warn("[dte-reconciliation] documento reclamado/bloqueado sin vincular", {
        code: "DTE_RECONCILIATION_DOCUMENT_BLOCKED",
        dteDocumentId: doc.id,
      })
      continue
    }
    const invoice = invoiceByFolioAndRut.get(docKey)
    if (!invoice) continue

    // Mismo piso de fecha que exigen las dos rutas manuales
    // (`validateDteForInvoiceTx` y `selectDteCandidates`): un DTE anterior a la
    // orden no puede ser el documento de esta compra, por más que folio y RUT
    // calcen.
    if (doc.fechaEmision < localDateToISO(new Date(invoice.purchaseOrder.createdAt))) continue

    const dteTotal = doc.montoTotal ?? 0
    const entityTotal = invoice.amount ?? 0
    const discrepancy = Math.abs(dteTotal - entityTotal)
    const discrepancyPercent = entityTotal !== 0
      ? (discrepancy / Math.abs(entityTotal)) * 100
      : (discrepancy > 0 ? 100 : 0)

    // Fuera de tolerancia el documento queda como CANDIDATO, no como vínculo:
    // `selectDteCandidates` lo sigue ofreciendo en la OC para que una persona
    // decida. Escribirlo solo dejaba evidencia tributaria de otra compra
    // colgada de esta factura, con la diferencia visible sólo tras filtrar.
    if (!amountsMatchForAutoLink(dteTotal, entityTotal)) {
      logger.warn("[dte-reconciliation] monto fuera de tolerancia, sin vincular", {
        code: "DTE_RECONCILIATION_AMOUNT_MISMATCH",
        dteDocumentId: doc.id,
        invoiceId: invoice.id,
      })
      continue
    }

    // Vincular el DTE con la factura de OC
    const linked = await linkDteToPurchaseOrderInvoice(doc.id, invoice.id)
    if (!linked) continue

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
        columns: { createdAt: true },
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
      isNull(dteDocuments.fuelLoadId),
      inArray(dteDocuments.tipoDte, ["33", "34"]),
    ),
    columns: { id: true, folio: true, rutEmisor: true, montoTotal: true, fechaEmision: true, estadoPlataforma: true },
  })

  const cleaned = cleanRut(supplierRut)
  // Mismos filtros que la ruta manual (`selectDteCandidates`): mismo proveedor,
  // emitido desde que la orden existe y no reclamado/bloqueado en la
  // plataforma. Sin el piso de fecha, tipear el folio de otra compra del mismo
  // proveedor colgaba acá el DTE equivocado sin decírselo a nadie.
  const createdOn = localDateToISO(new Date(invoice.purchaseOrder.createdAt))
  const matching = candidates.filter((doc) => (
    cleanRut(doc.rutEmisor) === cleaned
    && doc.fechaEmision >= createdOn
    && !isBlockedPlatformStatus(doc.estadoPlataforma)
  ))

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

  // Igual que en el cruce de la sincronización: sin calce de monto no se
  // escribe el vínculo, el documento queda ofrecido como candidato en la OC.
  if (!amountsMatchForAutoLink(dteTotal, entityTotal)) {
    logger.warn("[dte-reconciliation] monto fuera de tolerancia, sin vincular", {
      code: "DTE_RECONCILIATION_AMOUNT_MISMATCH",
      dteDocumentId: doc.id,
      invoiceId: invoice.id,
    })
    return null
  }

  const linked = await linkDteToPurchaseOrderInvoice(doc.id, invoice.id)
  if (!linked) return null

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

/**
 * Vincula una factura de OC bajo un lock del padre y una guarda de ocupación.
 * El índice único sigue siendo la última barrera, pero la transacción evita que
 * dos conciliadores elijan la misma factura por una lectura simultánea.
 */
async function linkDteToPurchaseOrderInvoice(dteId: string, invoiceId: string): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx.select({ id: purchaseOrderInvoices.id })
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, invoiceId))
        .for("update")
        .limit(1)
      if (!invoice) return false

      const [occupied] = await tx.select({ id: dteDocuments.id })
        .from(dteDocuments)
        .where(and(
          eq(dteDocuments.purchaseOrderInvoiceId, invoiceId),
          ne(dteDocuments.id, dteId),
        ))
        .limit(1)
      if (occupied) {
        logger.warn("[dte-reconciliation] factura de OC ya vinculada", {
          code: "DTE_RECONCILIATION_PURCHASE_INVOICE_OCCUPIED",
          invoiceId,
        })
        return false
      }

      const linked = await tx.update(dteDocuments).set({
        purchaseOrderInvoiceId: invoiceId,
      }).where(and(
        eq(dteDocuments.id, dteId),
        isNull(dteDocuments.purchaseOrderInvoiceId),
        isNull(dteDocuments.fuelLoadId),
      )).returning({ id: dteDocuments.id })
      return linked.length === 1
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn("[dte-reconciliation] carrera al vincular factura de OC", {
        code: "DTE_RECONCILIATION_PURCHASE_INVOICE_RACE",
        invoiceId,
      })
      return false
    }
    throw error
  }
}

/**
 * Espejo de `linkDteToPurchaseOrderInvoice` para el lado combustible: sin él, el
 * UPDATE sólo comprobaba que el DOCUMENTO estuviera libre, nunca que la CARGA
 * lo estuviera, y dos DTE podían quedar imputados a la misma compra sin ninguna
 * barrera (el índice único parcial sobre `fuel_load_id` es la última).
 */
async function linkDteToFuelLoad(dteId: string, loadId: string): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [load] = await tx.select({ id: fuelLoads.id })
        .from(fuelLoads)
        .where(eq(fuelLoads.id, loadId))
        .for("update")
        .limit(1)
      if (!load) return false

      const [occupied] = await tx.select({ id: dteDocuments.id })
        .from(dteDocuments)
        .where(and(
          eq(dteDocuments.fuelLoadId, loadId),
          ne(dteDocuments.id, dteId),
        ))
        .limit(1)
      if (occupied) {
        logger.warn("[dte-reconciliation] carga de combustible ya vinculada", {
          code: "DTE_RECONCILIATION_FUEL_LOAD_OCCUPIED",
          loadId,
        })
        return false
      }

      const linked = await tx.update(dteDocuments).set({
        fuelLoadId: loadId,
      }).where(and(
        eq(dteDocuments.id, dteId),
        isNull(dteDocuments.purchaseOrderInvoiceId),
        isNull(dteDocuments.fuelLoadId),
      )).returning({ id: dteDocuments.id })
      return linked.length === 1
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn("[dte-reconciliation] carrera al vincular carga de combustible", {
        code: "DTE_RECONCILIATION_FUEL_LOAD_RACE",
        loadId,
      })
      return false
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") return false
    const candidate = current as { code?: unknown; cause?: unknown }
    if (candidate.code === "23505") return true
    current = candidate.cause
  }
  return false
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
      isNull(dteDocuments.purchaseOrderInvoiceId),
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
      estadoPlataforma: true,
    },
  })

  if (unmatchedDocs.length === 0) return matches

  // Igual que en el cruce contra OC, un 33 y un 34 con el mismo folio/RUT son
  // dos documentos tributarios candidatos para una sola carga. Vincular ambos
  // por orden de llegada dejaría una evidencia ambigua en combustible, aunque
  // el check de vínculo único sólo impida que un DTE apunte a dos dominios.
  const ambiguousDocuments = await ambiguousDocumentKeys(unmatchedDocs, codEmp)
  for (const key of ambiguousDocuments) {
    logger.warn("[dte-reconciliation] documentos 33/34 ambiguos", {
      code: "DTE_RECONCILIATION_AMBIGUOUS_DOCUMENT_TYPE",
      key,
    })
  }

  // `receiptNumber` también lo tipea una persona: se normaliza igual que el
  // número de factura de OC (ver folio-match.ts).
  const folios = uniqueNormalizedFolios(unmatchedDocs)
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
    const docKey = folioRutKey(doc.folio, cleanRut(doc.rutEmisor))
    if (ambiguousDocuments.has(docKey)) continue
    if (isBlockedPlatformStatus(doc.estadoPlataforma)) {
      logger.warn("[dte-reconciliation] documento reclamado/bloqueado sin vincular", {
        code: "DTE_RECONCILIATION_DOCUMENT_BLOCKED",
        dteDocumentId: doc.id,
      })
      continue
    }
    const load = loadByReceiptAndRut.get(docKey)
    if (!load) continue

    const dteTotal = doc.montoTotal ?? 0
    const entityTotal = load.totalAmount ?? 0
    const discrepancy = Math.abs(dteTotal - entityTotal)
    const discrepancyPercent = entityTotal !== 0
      ? (discrepancy / Math.abs(entityTotal)) * 100
      : (discrepancy > 0 ? 100 : 0)

    const linked = await linkDteToFuelLoad(doc.id, load.id)
    if (!linked) continue

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

// ── Discrepancias de monto ───────────────────────────────────────────────────

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
 * no se vincularon a ninguna carga. Se exige que el RUT emisor pertenezca a
 * `fuelSuppliers` — la única forma honesta de mostrar "NC de combustible" en el
 * Dashboard sin conflar dominios (una NC sin vínculo puede ser de cualquiera).
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

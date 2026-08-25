"use server"

import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrders, suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { cleanRut } from "@/lib/rut"
import { localDateToISO } from "@/lib/sst/date"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { DTE_INVOICE_TIPOS } from "@/lib/services/purchasing-module/dte-candidates"
import { enrichDteDocumentLines } from "@/lib/services/dte-portal/purchase-document-xml"
import { runWithConcurrency } from "@/lib/concurrency"
import { assertOrderAccess } from "../actions.helpers"

/**
 * Máximo de documentos por pulsación. Cada uno es una descarga al portal
 * disparada por un clic; el tope evita que una OC de un proveedor muy activo
 * convierta el botón en un raspado largo. Los que sobren quedan para la
 * siguiente pulsación o para la sincronización.
 */
const MAX_PER_RUN = 10

/** Igual que la sincronización: dos descargas en paralelo, para cuidar el portal. */
const CONCURRENCY = 2

/**
 * Analiza las líneas de los DTE candidatos de una OC que todavía no las tienen.
 *
 * Existe porque "Actualizar sugerencias" sólo releía la lista: un documento que
 * nunca se enriqueció mostraba "Pendiente de análisis" hasta la próxima
 * sincronización del portal, y usarlo así hacía que el servidor vinculara sus
 * líneas sin que nadie las revisara. Esto permite pedir el análisis en el
 * momento, que es cuando la factura está sobre la mesa.
 *
 * El tope de tres intentos es el mismo de la sincronización: un XML que no
 * existe en el portal no mejora porque se pulse el botón quince veces.
 */
export async function analyzeDteCandidateLines(
  purchaseOrderId: string,
): Promise<{ ok: boolean; message: string }> {
  let session
  try {
    // Mismo permiso que adjuntar: el botón vive dentro del formulario de alta y
    // esto sale al portal con las credenciales de la empresa.
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, message: "Sin permisos para analizar DTE" }
  }

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(purchaseOrderId)) {
    return { ok: false, message: "Orden de compra no encontrada" }
  }

  let accessError: Awaited<ReturnType<typeof assertOrderAccess>>
  try {
    accessError = await assertOrderAccess(session, purchaseOrderId)
  } catch {
    return { ok: false, message: "No se pudo acceder a la orden" }
  }
  if (accessError) return { ok: false, message: accessError.message ?? "No se pudo acceder a la orden" }

  const [order] = await db
    .select({ createdAt: purchaseOrders.createdAt, supplierRut: suppliers.rut })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.id, purchaseOrderId))
  if (!order) return { ok: false, message: "Orden de compra no encontrada" }
  if (!order.supplierRut) return { ok: false, message: "El proveedor de esta OC no tiene RUT cargado" }

  const supplier = cleanRut(order.supplierRut)
  if (!supplier) return { ok: false, message: "El RUT del proveedor de esta OC no es válido" }

  // El RUT se compara en memoria y no en SQL por la misma razón que en el
  // detalle de la OC: `suppliers.rut` se ingresa a mano y no siempre trae el
  // formato del portal. Lo barato (vínculo, tipo, fecha, intentos) sí se acota
  // en la consulta.
  const pending = await db.query.dteDocuments.findMany({
    columns: { id: true, rutEmisor: true },
    where: and(
      isNull(dteDocuments.purchaseOrderInvoiceId),
      isNull(dteDocuments.fuelLoadId),
      inArray(dteDocuments.tipoDte, [...DTE_INVOICE_TIPOS]),
      gte(dteDocuments.fechaEmision, localDateToISO(new Date(order.createdAt))),
      ne(dteDocuments.lineEnrichmentStatus, "ready"),
      lt(dteDocuments.lineEnrichmentAttempts, 3),
    ),
    orderBy: (doc, { desc }) => [desc(doc.fechaEmision)],
  })
  const targets = pending
    .filter((doc) => cleanRut(doc.rutEmisor) === supplier)
    .slice(0, MAX_PER_RUN)

  if (targets.length === 0) {
    return { ok: true, message: "No hay DTE pendientes de análisis para esta orden." }
  }

  let ready = 0
  await runWithConcurrency(targets, CONCURRENCY, async (doc) => {
    try {
      const result = await enrichDteDocumentLines(doc.id)
      if (result.ok) ready += 1
      else {
        logger.warn("[analyzeDteCandidateLines] XML no enriquecido", {
          code: result.errorCode,
          purchaseOrderId,
          dteDocumentId: doc.id,
        })
      }
    } catch {
      logger.warn("[analyzeDteCandidateLines] enriquecimiento no disponible", {
        code: "DTE_XML_ENRICHMENT_FAILED",
        purchaseOrderId,
        dteDocumentId: doc.id,
      })
    }
  })

  revalidateOperationalViews([`/compras/${purchaseOrderId}`])

  const failed = targets.length - ready
  // Se nombra lo que no se pudo: un "listo" a secas sobre un documento que
  // sigue sin líneas manda a confirmar a ciegas.
  const remaining = pending.filter((doc) => cleanRut(doc.rutEmisor) === supplier).length - targets.length
  return {
    ok: true,
    message: [
      ready > 0 ? `${ready} DTE analizado(s).` : null,
      failed > 0 ? `${failed} sin XML disponible en el portal.` : null,
      remaining > 0 ? `Quedan ${remaining} por analizar: vuelve a pulsar.` : null,
    ].filter(Boolean).join(" ") || "No se pudo analizar ningún DTE.",
  }
}

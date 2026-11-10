"use server"

import { z } from "zod"
import { db, type Tx } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { searchSpareParts, createSparePartTx, findSparePartByPartNumber, type SparePartListItem } from "@/lib/services/spare-parts-catalog"
import { getSparePartLinkInfo, type SparePartLinkInfo } from "@/lib/services/purchasing-module/spare-part-link"
import { sparePartUnitMismatchMessage } from "@/lib/services/purchasing-module/spare-part-unit"
import { dbErrMsg } from "./helpers"

/**
 * Catalogar al comprar (T7): las acciones que usa la hoja «Catalogar» del
 * formulario de Nueva OC.
 *
 * - Buscar y vincular exigen `purchasing:create_order` (quien arma la OC).
 * - Crear un repuesto nuevo exige además `repuestos:catalog`: ensucia el
 *   catálogo para todos, así que no basta con poder comprar.
 *
 * Ninguna escribe el vínculo: eso ocurre al crear la OC, que revalida el
 * repuesto bajo bloqueo (`purchase-orders-create.ts`).
 */

/** Cuántos repuestos devuelve la búsqueda; el buscador se afina escribiendo. */
const SEARCH_LIMIT = 40

export interface SparePartChoice {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  /** Unidad en que se compra: la línea tiene que pedir la misma para vincularlo. */
  unitOfMeasure: string
  /** Último precio conocido (proveedor preferido, o el más reciente). */
  lastPrice: number | null
  /** Fecha ISO de la última compra con OC emitida. */
  lastPurchasedAt: string | null
  /** `vehicle`: ya se compró para este equipo; `model`: para otro de su misma marca y modelo. */
  vehicleMatch: "vehicle" | "model" | null
}

export type SearchSparePartsResult =
  | { ok: true; parts: SparePartChoice[]; total: number; suggestion: SparePartChoice | null }
  | { ok: false; message: string }

export type SparePartLinkResult =
  | { ok: true; part: SparePartLinkInfo }
  | { ok: false; message: string }

const searchSchema = z.object({
  query: z.string().trim().max(100).optional().default(""),
  vehicleId: z.string().trim().max(64).nullish(),
  /** Sólo al abrir la hoja: el N° de parte que escribió quien pidió, para sugerir el repuesto exacto. */
  partNumber: z.string().trim().max(100).nullish(),
  /** Solicitud de la línea: sus propias líneas no cuentan como «ya se compró para este equipo». */
  requestId: z.string().trim().max(64).nullish(),
})

const linkSchema = z.object({
  productId: z.string().trim().min(1, "Repuesto requerido").max(64),
  /** Unidad de la línea: el vínculo exige la misma (la OC la vuelve a exigir al crearse). */
  unitOfMeasure: z.string().trim().max(24).nullish(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre del repuesto").max(200, "El nombre es demasiado largo"),
  partNumber: z.string().trim().max(100, "El N° de parte es demasiado largo").nullish(),
  partBrand: z.string().trim().max(100, "La marca es demasiado larga").nullish(),
  unitOfMeasure: z.string().trim().toLowerCase().min(1, "Unidad requerida").max(24),
})

function toChoice(part: SparePartListItem): SparePartChoice {
  return {
    id: part.id,
    sku: part.sku,
    name: part.name,
    partNumber: part.partNumber,
    partBrand: part.partBrand,
    unitOfMeasure: part.unitOfMeasure,
    lastPrice: part.lastPrice,
    lastPurchasedAt: part.lastPurchasedAt,
    vehicleMatch: part.vehicleMatch,
  }
}

export async function searchSparePartsForOcAction(input: z.input<typeof searchSchema>): Promise<SearchSparePartsResult> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para vincular repuestos a una orden de compra" }
  }
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa la búsqueda" }
  const { query, vehicleId, partNumber, requestId } = parsed.data

  try {
    // Filtro, orden por vehículo y tope en SQL: el catálogo no viaja entero.
    // `purchasing:create_order` no es sólo de roles de oficina (también lo tiene
    // la secretaría de faena): el orden por equipo y «mismo modelo» se recortan
    // al alcance de faenas de la sesión, como en el buscador de la solicitud.
    // Un rol global sigue viendo toda la flota.
    const vehicleScope = serviceWorksiteScope(session)
    const excludeRequestId = requestId || undefined
    const found = await searchSpareParts({ query: query || undefined, vehicleId: vehicleId || undefined, vehicleScope, excludeRequestId, limit: SEARCH_LIMIT })
    // La sugerencia sólo se pide al abrir la hoja; puede quedar fuera del tope,
    // así que se lee aparte, con el mismo vehículo para su insignia.
    const suggestionRow = partNumber ? await findSparePartByPartNumber(partNumber) : null
    const suggestion = suggestionRow
      ? (found.parts.find((part) => part.id === suggestionRow.id)
        ?? (await searchSpareParts({ ids: [suggestionRow.id], vehicleId: vehicleId || undefined, vehicleScope, excludeRequestId })).parts[0]
        ?? null)
      : null
    return {
      ok: true,
      parts: found.parts.map(toChoice),
      total: found.total,
      suggestion: suggestion ? toChoice(suggestion) : null,
    }
  } catch (e) {
    logger.error("[searchSparePartsForOcAction]", e)
    return { ok: false, message: dbErrMsg(e, "No se pudo buscar en el catálogo de repuestos") }
  }
}

/** Confirma que el repuesto sigue activo, que se compra en la unidad de la línea, y trae sus precios por proveedor. */
export async function linkSparePartForOcAction(input: z.input<typeof linkSchema>): Promise<SparePartLinkResult> {
  try {
    await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para vincular repuestos a una orden de compra" }
  }
  const parsed = linkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Elige un repuesto" }

  try {
    const part = await getSparePartLinkInfo(parsed.data.productId)
    if (!part) return { ok: false, message: "El repuesto ya no está disponible en el catálogo" }
    const unitMismatch = parsed.data.unitOfMeasure
      ? sparePartUnitMismatchMessage(part, parsed.data.unitOfMeasure)
      : null
    if (unitMismatch) return { ok: false, message: unitMismatch }
    return { ok: true, part }
  } catch (e) {
    logger.error("[linkSparePartForOcAction]", e)
    return { ok: false, message: dbErrMsg(e, "No se pudo vincular el repuesto") }
  }
}

/** Crea un repuesto nuevo en el catálogo desde la línea y lo devuelve listo para vincular. */
export async function createSparePartForOcAction(input: z.input<typeof createSchema>): Promise<SparePartLinkResult> {
  let session
  try {
    session = await requirePermission("repuestos:catalog")
  } catch {
    return { ok: false, message: "Sin permisos para crear repuestos en el catálogo" }
  }
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos del repuesto" }
  }
  const { name, partNumber, partBrand, unitOfMeasure } = parsed.data

  try {
    const created = await db.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
      name,
      partNumber: partNumber || null,
      partBrand: partBrand || null,
      unitOfMeasure,
      createdByUserId: session.user.id,
    }))
    const part = await getSparePartLinkInfo(created.id)
    if (!part) return { ok: false, message: "El repuesto se creó pero no se pudo leer; búscalo en el catálogo" }
    return { ok: true, part }
  } catch (e) {
    // Un N° de parte repetido o una unidad inactiva son validaciones de negocio:
    // vuelven a la hoja tal cual y no se registran como error. `dbErrMsg` sí
    // registra lo interno (driver, esquema) y no lo muestra.
    return { ok: false, message: dbErrMsg(e, "No se pudo crear el repuesto") }
  }
}

"use server"

import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { fuelVehicles, suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { SPARE_PART_SEARCH_LIMIT, searchSpareParts } from "@/lib/services/spare-parts-catalog"
import { toSparePartOption } from "../spare-part-options"
import type { SparePartOption } from "../request-form.types"

/**
 * Buscador de repuestos de «Solicitud de repuestos»: el formulario pregunta
 * mientras se escribe en vez de recibir el catálogo entero.
 *
 * - Sin texto: sólo lo comprado para el equipo del ítem o para otro de su marca y
 *   modelo (la lista inicial). Sin equipo, nada: se busca escribiendo.
 * - Con texto: nombre, SKU, N° de parte o marca, con lo del equipo primero.
 *
 * Mismo permiso que ofrece el buscador en la página (`repuestos:create`). El
 * equipo y lo que se devuelve de él se recortan al alcance de faenas de la
 * sesión: el orden no puede delatar el parque de otra faena.
 */

export type SearchSparePartsForRequestResult =
  | { ok: true; parts: SparePartOption[]; total: number }
  | { ok: false; message: string }

const schema = z.object({
  query: z.string().trim().max(100).optional().default(""),
  vehicleId: z.string().trim().max(64).nullish(),
})

export async function searchSparePartsForRequestAction(
  input: z.input<typeof schema>,
): Promise<SearchSparePartsForRequestResult> {
  let session
  try {
    session = await requirePermission("repuestos:create")
  } catch {
    return { ok: false, message: "Sin permisos para pedir repuestos del catálogo" }
  }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa la búsqueda" }
  const { query } = parsed.data

  try {
    const visibleVehicleIds = new Set((await db
      .select({ id: fuelVehicles.id })
      .from(fuelVehicles)
      .where(and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId)))
    ).map((vehicle) => vehicle.id))
    const vehicleId = parsed.data.vehicleId && visibleVehicleIds.has(parsed.data.vehicleId) ? parsed.data.vehicleId : undefined

    // «Mismo modelo» también se recorta a las faenas de la sesión: un equipo de
    // otra faena con la misma marca y modelo no puede subir un repuesto.
    const vehicleScope = serviceWorksiteScope(session)
    const found = await searchSpareParts(query
      ? { query, vehicleId, vehicleScope, limit: SPARE_PART_SEARCH_LIMIT }
      : { vehicleId, vehicleScope, onlyVehicleMatches: true, limit: SPARE_PART_SEARCH_LIMIT })

    const supplierIds = [...new Set(found.parts.flatMap((part) => part.preferredSupplierId ? [part.preferredSupplierId] : []))]
    const activeSupplierIds = new Set(supplierIds.length === 0 ? [] : (await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(inArray(suppliers.id, supplierIds), eq(suppliers.isActive, true)))
    ).map((supplier) => supplier.id))

    return {
      ok: true,
      parts: found.parts.map((part) => toSparePartOption(part, { activeSupplierIds, visibleVehicleIds })),
      total: found.total,
    }
  } catch (e) {
    logger.error("[searchSparePartsForRequestAction]", e)
    return { ok: false, message: "No se pudo buscar en el catálogo de repuestos" }
  }
}

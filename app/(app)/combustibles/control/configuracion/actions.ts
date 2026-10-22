"use server"

import { revalidatePath } from "next/cache"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { clients, fuelEquipmentTypes, fuelMandanteWorksites, fuelMandantes, fuelSuppliers, fuelSupplyMedia, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import { nanoid } from "@/lib/id"
import {
  equipmentFamilyInputSchema,
  findAliasConflicts,
  mandanteInputSchema,
  nameKey,
  providerMappingFromColumns,
  slugify,
  supplyMediumInputSchema,
  toggleActiveSchema,
  uniqueSlug,
  type EquipmentFamilyInput,
  type MandanteInput,
  type SupplyMediumInput,
} from "@/lib/combustibles/control/catalogs"

/**
 * Configuración del control: mandantes, medios de suministro y familias de
 * equipos. TODA acción exige `combustibles:manage_control`, valida con zod en el
 * servidor y audita con estado anterior y nuevo dentro de la misma transacción.
 * Los umbrales y el recálculo están en `actions-thresholds.ts`.
 */

export interface ConfigResult {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
  data?: Record<string, unknown>
}

const PERMISSION = "combustibles:manage_control" as const

function refresh() {
  revalidatePath("/combustibles/control/configuracion")
  // Mandantes, medios y familias alimentan los filtros y vistas de todo el control.
  revalidatePath("/combustibles/control", "layout")
}

// ── Mandantes ────────────────────────────────────────────────────────────────

export async function saveMandanteAction(input: MandanteInput): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(mandanteInputSchema, input)
  if (!parsed.ok) return parsed
  const data = parsed.data
  const scope = serviceWorksiteScope(session)
  const inScope = (worksiteId: string) => scope === "all" || scope.includes(worksiteId)

  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult> => {
      const existing = data.id
        ? await tx.query.fuelMandantes.findFirst({ where: eq(fuelMandantes.id, data.id), with: { worksites: true } })
        : undefined
      if (data.id && !existing) return { ok: false, message: "El mandante ya no existe. Recarga la página." }

      const allNames = await tx.select({ id: fuelMandantes.id, name: fuelMandantes.name }).from(fuelMandantes)
      if (allNames.some((row) => row.id !== data.id && nameKey(row.name) === nameKey(data.name))) {
        return { ok: false, message: "Ya existe un mandante con ese nombre", fieldErrors: { name: ["Ya existe un mandante con ese nombre"] } }
      }
      if (data.clientId) {
        const client = await tx.query.clients.findFirst({ where: eq(clients.id, data.clientId), columns: { id: true } })
        if (!client) return { ok: false, message: "El cliente elegido no existe", fieldErrors: { clientId: ["El cliente elegido no existe"] } }
      }

      const found = data.worksiteIds.length
        ? await tx.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, data.worksiteIds))
        : []
      if (found.length !== data.worksiteIds.length) return { ok: false, message: "Alguna faena elegida ya no existe. Recarga la página." }
      if (data.worksiteIds.some((id) => !inScope(id))) return { ok: false, message: "No tienes acceso a una de las faenas elegidas" }

      const taken = data.worksiteIds.length
        ? await tx.select({ worksiteId: fuelMandanteWorksites.worksiteId, mandanteId: fuelMandanteWorksites.mandanteId })
            .from(fuelMandanteWorksites)
            .where(and(inArray(fuelMandanteWorksites.worksiteId, data.worksiteIds), data.id ? ne(fuelMandanteWorksites.mandanteId, data.id) : undefined))
        : []
      if (taken.length > 0 && !data.confirmMove) {
        const names = new Map(allNames.map((row) => [row.id, row.name]))
        const worksiteNames = new Map(found.map((row) => [row.id, row.name]))
        return {
          ok: false,
          message: "Hay faenas que hoy pertenecen a otro mandante. Confirma el cambio para moverlas.",
          data: { conflicts: taken.map((row) => ({ worksiteId: row.worksiteId, worksiteName: worksiteNames.get(row.worksiteId) ?? row.worksiteId, mandanteName: names.get(row.mandanteId) ?? row.mandanteId })) },
        }
      }

      const id = data.id ?? `fmd-${nanoid()}`
      const row = { name: data.name, clientId: data.clientId, tolerancePct: data.tolerancePct, isActive: data.isActive }
      if (existing) await tx.update(fuelMandantes).set({ ...row, updatedAt: new Date().toISOString() }).where(eq(fuelMandantes.id, id))
      else await tx.insert(fuelMandantes).values({ id, ...row })

      // Faenas de este mandante: se quitan las que salieron de la lista (solo las del alcance
      // de quien edita: las demás no se ven en el formulario y no deben perderse en silencio).
      const previous = (existing?.worksites ?? []).map((link) => link.worksiteId)
      const removable = previous.filter((worksiteId) => inScope(worksiteId) && !data.worksiteIds.includes(worksiteId))
      if (removable.length) await tx.delete(fuelMandanteWorksites).where(and(eq(fuelMandanteWorksites.mandanteId, id), inArray(fuelMandanteWorksites.worksiteId, removable)))
      if (data.worksiteIds.length) {
        await tx.insert(fuelMandanteWorksites)
          .values(data.worksiteIds.map((worksiteId) => ({ worksiteId, mandanteId: id })))
          .onConflictDoUpdate({ target: fuelMandanteWorksites.worksiteId, set: { mandanteId: id } })
      }

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: existing ? "update" : "create",
        entityType: "fuel_mandante",
        entityId: id,
        oldState: existing ? { name: existing.name, clientId: existing.clientId, tolerancePct: existing.tolerancePct, isActive: existing.isActive, worksiteIds: previous } : undefined,
        newState: { ...row, worksiteIds: data.worksiteIds, movedFromOtherMandante: taken.map((link) => ({ worksiteId: link.worksiteId, mandanteId: link.mandanteId })) },
      }, tx)
      return { ok: true, message: existing ? "Mandante actualizado" : "Mandante creado", data: { id } }
    })
    if (result.ok) refresh()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo guardar el mandante", { unique: { "*": "Ya existe un mandante con ese nombre" } })
  }
}

export async function setMandanteActiveAction(input: { id: string; isActive: boolean }): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(toggleActiveSchema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult> => {
      const existing = await tx.query.fuelMandantes.findFirst({ where: eq(fuelMandantes.id, parsed.data.id) })
      if (!existing) return { ok: false, message: "El mandante ya no existe. Recarga la página." }
      await tx.update(fuelMandantes).set({ isActive: parsed.data.isActive, updatedAt: new Date().toISOString() }).where(eq(fuelMandantes.id, existing.id))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_mandante",
        entityId: existing.id,
        oldState: { isActive: existing.isActive },
        newState: { isActive: parsed.data.isActive },
      }, tx)
      return { ok: true, message: parsed.data.isActive ? "Mandante activado" : "Mandante desactivado" }
    })
    if (result.ok) refresh()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo cambiar el estado del mandante")
  }
}

// ── Medios de suministro ─────────────────────────────────────────────────────

export async function saveSupplyMediumAction(input: SupplyMediumInput): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(supplyMediumInputSchema, input)
  if (!parsed.ok) return parsed
  const data = parsed.data

  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult> => {
      const all = await tx.select().from(fuelSupplyMedia).orderBy(asc(fuelSupplyMedia.sortOrder))
      const existing = data.id ? all.find((row) => row.id === data.id) : undefined
      if (data.id && !existing) return { ok: false, message: "El medio ya no existe. Recarga la página." }

      if (all.some((row) => row.id !== data.id && nameKey(row.name) === nameKey(data.name))) {
        return { ok: false, message: "Ya existe un medio con ese nombre", fieldErrors: { name: ["Ya existe un medio con ese nombre"] } }
      }
      const conflicts = findAliasConflicts(data.aliases, all, data.id)
      if (conflicts.length) {
        const message = conflicts.map((conflict) => `«${conflict.alias}» ya es alias de ${conflict.mediumName}`).join("; ")
        return { ok: false, message, fieldErrors: { aliases: [message] } }
      }
      if (data.fuelSupplierId) {
        const supplier = await tx.query.fuelSuppliers.findFirst({ where: eq(fuelSuppliers.id, data.fuelSupplierId), columns: { id: true } })
        if (!supplier) return { ok: false, message: "El proveedor elegido no existe", fieldErrors: { fuelSupplierId: ["El proveedor elegido no existe"] } }
      }

      const id = existing?.id ?? `fsm-${nanoid()}`
      const row = {
        name: data.name,
        kind: data.kind,
        fuelSupplierId: data.fuelSupplierId,
        providerCode: data.providerCode,
        providerChannel: data.providerChannel,
        aliases: data.aliases,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      }
      if (existing) {
        await tx.update(fuelSupplyMedia).set({ ...row, updatedAt: new Date().toISOString() }).where(eq(fuelSupplyMedia.id, id))
      } else {
        const slug = uniqueSlug(slugify(data.name), all.map((medium) => medium.slug))
        await tx.insert(fuelSupplyMedia).values({ id, slug, ...row })
      }
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: existing ? "update" : "create",
        entityType: "fuel_supply_medium",
        entityId: id,
        oldState: existing
          ? { name: existing.name, kind: existing.kind, fuelSupplierId: existing.fuelSupplierId, providerMapping: providerMappingFromColumns(existing.providerCode, existing.providerChannel), aliases: existing.aliases, sortOrder: existing.sortOrder, isActive: existing.isActive }
          : undefined,
        newState: { ...row, providerMapping: data.providerMapping },
      }, tx)
      return { ok: true, message: existing ? "Medio de suministro actualizado" : "Medio de suministro creado", data: { id } }
    })
    if (result.ok) refresh()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo guardar el medio de suministro", { unique: { "*": "Ya existe un medio con ese nombre" } })
  }
}

export async function setSupplyMediumActiveAction(input: { id: string; isActive: boolean }): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(toggleActiveSchema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult> => {
      const existing = await tx.query.fuelSupplyMedia.findFirst({ where: eq(fuelSupplyMedia.id, parsed.data.id) })
      if (!existing) return { ok: false, message: "El medio ya no existe. Recarga la página." }
      await tx.update(fuelSupplyMedia).set({ isActive: parsed.data.isActive, updatedAt: new Date().toISOString() }).where(eq(fuelSupplyMedia.id, existing.id))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_supply_medium",
        entityId: existing.id,
        oldState: { isActive: existing.isActive },
        newState: { isActive: parsed.data.isActive },
      }, tx)
      return { ok: true, message: parsed.data.isActive ? "Medio activado" : "Medio desactivado" }
    })
    if (result.ok) refresh()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo cambiar el estado del medio")
  }
}

// ── Familias de equipos ──────────────────────────────────────────────────────

export async function setEquipmentTypeFamilyAction(input: EquipmentFamilyInput): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(equipmentFamilyInputSchema, input)
  if (!parsed.ok) return parsed
  const { equipmentTypeId, family } = parsed.data
  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult> => {
      const existing = await tx.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, equipmentTypeId) })
      if (!existing) return { ok: false, message: "El tipo de equipo ya no existe. Recarga la página." }
      if (existing.performanceFamily === family) return { ok: true, message: "Sin cambios" }
      await tx.update(fuelEquipmentTypes).set({ performanceFamily: family, updatedAt: new Date().toISOString() }).where(eq(fuelEquipmentTypes.id, equipmentTypeId))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_equipment_type",
        entityId: equipmentTypeId,
        entityCode: existing.slug,
        oldState: { performanceFamily: existing.performanceFamily },
        newState: { performanceFamily: family },
      }, tx)
      return { ok: true, message: family ? "Familia actualizada" : "El tipo salió de las vistas de rendimiento" }
    })
    if (result.ok) {
      refresh()
      revalidatePath("/admin/flota-catalogos/tipos-equipo")
    }
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo cambiar la familia del tipo de equipo")
  }
}

import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, worksites } from "@/db/schema"
import { cleanName, findByNameKey, isValidPlate, normalizeCode, normalizePlate } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import { isUniqueViolation } from "@/lib/action-error"
import { actorEquipmentScope, isWorksiteInScope } from "./access"
import { ensureCatalogEntry } from "./catalogs"
import { applyCreate } from "./equipment"
import type { MantActor } from "./equipment-history"
import { loadEquipmentCatalogs, resolveEquipment, type EquipmentCatalogs, type EquipmentInput } from "./equipment-resolve"
import { unitFromMeter, type MantWorksiteScope } from "./fleet"

/**
 * «Incorporar desde la flota» (auditoría 2026-11-11). Los vehículos ya están en
 * la flota compartida (`fuel_vehicles`); a Mantención le falta sólo su ficha:
 * marca de la lista, pauta y lectura inicial. Esto lista los que no la tienen y
 * los incorpora sin volver a escribir código, patente, tipo ni faena —que no se
 * tocan—, con la misma validación (`resolveEquipment`) y la misma escritura
 * (`applyCreate`) que el formulario y la planilla.
 */

export const INCORPORATE_MAX_ROWS = 500

export interface IncorporationCandidate {
  vehicleId: string
  code: string | null
  plate: string
  typeName: string
  unit: MantUnit
  worksiteId: string
  worksiteName: string
  /** Marca de la flota, texto libre (puede no estar en la lista). */
  fleetBrand: string | null
  model: string | null
  year: number | null
  /** Marca de la lista que coincide con la de la flota, si hay. */
  suggestedBrandId: string | null
  /** La única pauta de la misma unidad, si hay exactamente una. */
  suggestedScheduleId: string | null
  /** Por qué no se puede incorporar todavía (se corrige en Vehículos), o `null`. */
  blocker: string | null
}

/** «Sin patente» en la flota se guarda con la patente igual al código. */
function plateIsCode(plate: string, code: string | null): boolean {
  return !!code && normalizeCode(plate) === normalizeCode(code)
}

function blockerFor(row: { code: string | null; plate: string }): string | null {
  if (!row.code?.trim()) return "No tiene código interno: asígnalo en Vehículos."
  const code = normalizeCode(row.code)
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) return `El código «${row.code}» no es válido: corrígelo en Vehículos.`
  if (plateIsCode(row.plate, row.code)) return null
  const plate = normalizePlate(row.plate)
  if (!plate || !isValidPlate(plate)) return `La patente «${row.plate}» no es válida: corrígela en Vehículos.`
  return null
}

/** Vehículos activos de la flota, con odómetro u horómetro, en las faenas de `scope`, que aún no están en Mantención. */
export async function listIncorporationCandidates(scope: MantWorksiteScope, catalogs?: EquipmentCatalogs): Promise<IncorporationCandidate[]> {
  if (Array.isArray(scope) && scope.length === 0) return []
  const rows = await db
    .select({
      vehicleId: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, brand: fuelVehicles.brand,
      model: fuelVehicles.model, year: fuelVehicles.year, worksiteId: fuelVehicles.worksiteId, worksiteName: worksites.name,
      typeName: fuelEquipmentTypes.name, meterType: fuelEquipmentTypes.defaultMeterType,
    })
    .from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .where(and(
      eq(fuelVehicles.isActive, true),
      eq(fuelEquipmentTypes.isActive, true),
      isNull(mantEquipmentProfiles.vehicleId),
      scope === "all" ? undefined : inArray(fuelVehicles.worksiteId, scope),
    ))
  const lists = catalogs ?? await loadEquipmentCatalogs(db)
  const activeBrands = lists.brands.filter((brand) => brand.isActive)
  const candidates: IncorporationCandidate[] = []
  for (const row of rows) {
    const unit = unitFromMeter(row.meterType)
    if (!unit) continue
    const schedules = lists.schedules.filter((schedule) => schedule.unit === unit)
    candidates.push({
      vehicleId: row.vehicleId, code: row.code, plate: row.plate, typeName: row.typeName, unit,
      worksiteId: row.worksiteId, worksiteName: row.worksiteName, fleetBrand: row.brand?.trim() || null,
      model: row.model?.trim() || null, year: row.year,
      suggestedBrandId: row.brand ? findByNameKey(activeBrands, row.brand)?.id ?? null : null,
      suggestedScheduleId: schedules.length === 1 ? schedules[0]!.id : null,
      blocker: blockerFor(row),
    })
  }
  return candidates.sort((a, b) => a.worksiteName.localeCompare(b.worksiteName, "es") || (a.code ?? a.plate).localeCompare(b.code ?? b.plate, "es"))
}

export interface IncorporationRowInput {
  vehicleId: string
  brandId: string
  /**
   * Marca nueva a crear (la de la flota, que no está en la lista). Sólo la
   * acepta quien ve todas las faenas; si viene, `brandId` se ignora.
   */
  newBrandName?: string | null
  scheduleId: string | null
  initialReading: number | null
  initialReadingDate: string | null
}

export interface IncorporationRowResult {
  vehicleId: string
  ok: boolean
  /** El error, en el lenguaje del formulario; vacío si se incorporó. */
  messages: string[]
}

export interface IncorporationResult {
  incorporated: number
  rows: IncorporationRowResult[]
}

/**
 * Incorpora los vehículos indicados en UNA transacción: las filas válidas se
 * escriben, las que traen error se informan una a una (no tumban a las demás).
 * Faena, tipo, código y patente salen de la flota, nunca del pedido.
 */
export async function incorporateFleetVehicles(actor: MantActor, rows: IncorporationRowInput[]): Promise<IncorporationResult> {
  const scope = actorEquipmentScope(actor)
  const attempt = () => db.transaction(async (tx) => {
    const catalogs = await loadEquipmentCatalogs(tx)
    const vehicleIds = rows.map((row) => row.vehicleId)
    const details = vehicleIds.length
      ? await tx.select({ id: fuelVehicles.id, model: fuelVehicles.model, year: fuelVehicles.year }).from(fuelVehicles).where(inArray(fuelVehicles.id, vehicleIds))
      : []
    const detailOf = new Map(details.map((row) => [row.id, row]))
    const results: IncorporationRowResult[] = []
    let incorporated = 0
    const seen = new Set<string>()
    for (const row of rows) {
      const fail = (...messages: string[]) => { results.push({ vehicleId: row.vehicleId, ok: false, messages }) }
      if (seen.has(row.vehicleId)) { fail("Ese vehículo viene dos veces."); continue }
      seen.add(row.vehicleId)
      const identity = catalogs.identities.find((item) => item.id === row.vehicleId)
      if (!identity) { fail("Ese vehículo ya no está en la flota."); continue }
      if (identity.hasProfile) { fail("Ese vehículo ya está en la mantención."); continue }
      if (!identity.isActive) { fail("Ese vehículo está inactivo en la flota: reactívalo en Vehículos."); continue }
      if (!isWorksiteInScope(scope, identity.worksiteId)) { fail("Ese vehículo es de una faena que no administras."); continue }
      const blocker = blockerFor(identity)
      if (blocker) { fail(blocker); continue }
      let brandId = row.brandId
      if (row.newBrandName?.trim()) {
        const typedBrand = cleanName(row.newBrandName)
        if (typedBrand.length < 2 || typedBrand.length > 80) { fail("El nombre de la marca debe tener entre 2 y 80 caracteres."); continue }
        if (scope !== "all") { fail("Sólo la jefatura que ve todas las faenas puede crear marcas: elige una de la lista."); continue }
        const brand = await ensureCatalogEntry(tx, "brands", row.newBrandName)
        if (!catalogs.brands.some((item) => item.id === brand.id)) catalogs.brands.push({ id: brand.id, name: cleanName(row.newBrandName), isActive: true })
        if (!catalogs.brands.find((item) => item.id === brand.id)?.isActive) { fail(`La marca «${cleanName(row.newBrandName)}» está desactivada. Actívala en Mantención › Catálogos.`); continue }
        brandId = brand.id
      }
      const detail = detailOf.get(row.vehicleId)
      const input: EquipmentInput = {
        code: identity.code ?? "",
        plate: identity.plate,
        noPlate: plateIsCode(identity.plate, identity.code),
        equipmentTypeId: identity.equipmentTypeId ?? "",
        brandId,
        model: detail?.model ?? "",
        year: detail?.year ?? null,
        worksiteId: identity.worksiteId ?? "",
        newWorksiteName: "",
        scheduleId: row.scheduleId,
        initialReading: row.initialReading,
        initialReadingDate: row.initialReadingDate,
      }
      const resolved = await resolveEquipment(tx, input, { current: null, catalogs, keepWorksiteId: identity.worksiteId })
      if (!resolved.ok) { fail(...Object.values(resolved.fieldErrors)); continue }
      if (resolved.incorporate?.id !== row.vehicleId) { fail("El código o la patente chocan con otro vehículo de la flota: corrígelo en Vehículos."); continue }
      await applyCreate(tx, actor, resolved.value, resolved.incorporate, "fleet")
      Object.assign(identity, { hasProfile: true })
      incorporated++
      results.push({ vehicleId: row.vehicleId, ok: true, messages: [] })
    }
    return { incorporated, rows: results }
  })
  try {
    return await attempt()
  } catch (error) {
    // Otra persona incorporó alguno a la vez: se reintenta una vez y ese sale como «ya está en la mantención».
    if (!isUniqueViolation(error)) throw error
    return attempt()
  }
}

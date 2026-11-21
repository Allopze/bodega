import { asc, eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { fleetOwners, fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, findByNameKey } from "@/lib/mantencion/normalize"

/**
 * Empresa propietaria de un equipo y marca «ubicación por confirmar»
 * (Trinorma, 2026-11-21). Ninguna de las dos cambia la faena del equipo: la
 * faena sólo se mueve con `transferVehiclesTx` (AGENTS.md) y el costo se
 * imputa a la faena de origen.
 */

import { FLEET_OWNER_NAME_MAX_LENGTH, isFleetOwnerKind, type FleetOwnerKind } from "@/lib/fleet/fleet-owner-kinds"

export { FLEET_OWNER_KINDS, FLEET_OWNER_KIND_LABELS, FLEET_OWNER_NAME_MAX_LENGTH, isFleetOwnerKind, type FleetOwnerKind } from "@/lib/fleet/fleet-owner-kinds"

export interface FleetOwnerActor {
  userId: string | null
  email?: string | null
}

export interface FleetOwnerRow {
  id: string
  name: string
  kind: FleetOwnerKind
  isActive: boolean
}

/** Clasificación del inventario de octubre (CONTRATOS.md, WP1 paso 4): por el nombre de la empresa. */
export function classifyFleetOwnerName(rawName: string): FleetOwnerKind {
  const name = rawName.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
  if (name === "CHOME") return "propia"
  if (name === "ASIR" || name === "ASIR Y ACUNA" || name === "SERVIMAR") return "relacionada"
  if (/\b(BANCO|BCO|SCOTIABANK|ITAU|LEASING)\b/.test(name)) return "financiera"
  return "tercero"
}

export async function listFleetOwners(client: Pick<Tx, "select">, options: { onlyActive?: boolean } = {}): Promise<FleetOwnerRow[]> {
  const rows = await client.select().from(fleetOwners).orderBy(asc(fleetOwners.name))
  return rows
    .filter((row) => !options.onlyActive || row.isActive)
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind as FleetOwnerKind, isActive: row.isActive }))
}

export type FleetOwnerResult<T> = { ok: true; message: string; data: T } | { ok: false; message: string }

/**
 * Crea una empresa propietaria. Si ya hay una con el mismo nombre (sin distinguir
 * mayúsculas ni tildes) se usa esa, como con el resto de los catálogos: no nacen
 * «Asir» y «ASIR» por separado.
 */
export async function createFleetOwnerTx(
  tx: Tx,
  actor: FleetOwnerActor,
  input: { name: string; kind: string },
): Promise<FleetOwnerResult<{ id: string; created: boolean }>> {
  const name = cleanName(input.name)
  if (name.length < 2) return { ok: false, message: "Escribe el nombre de la empresa (mínimo 2 letras)." }
  if (name.length > FLEET_OWNER_NAME_MAX_LENGTH) return { ok: false, message: `El nombre no puede pasar de ${FLEET_OWNER_NAME_MAX_LENGTH} caracteres.` }
  if (!isFleetOwnerKind(input.kind)) return { ok: false, message: "Elige el tipo de empresa." }
  const existing = findByNameKey(await tx.select().from(fleetOwners), name)
  if (existing) {
    if (!existing.isActive) return { ok: false, message: `La empresa ${existing.name} existe pero está inactiva.` }
    return { ok: true, message: `La empresa ${existing.name} ya existía: se usó esa.`, data: { id: existing.id, created: false } }
  }
  const id = nanoid()
  await tx.insert(fleetOwners).values({ id, name, kind: input.kind })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "fleet_owner",
    entityId: id,
    entityCode: name,
    newState: { name, kind: input.kind },
  }, tx)
  return { ok: true, message: `Empresa ${name} creada.`, data: { id, created: true } }
}

export interface VehicleOwnershipInput {
  vehicleId: string
  /** `undefined` = no tocar; `null` = sin informar. */
  ownerId?: string | null
  locationPendingConfirmation?: boolean
  reason?: string
}

/**
 * Asigna el propietario y/o la marca «ubicación por confirmar» de un equipo.
 * El alcance por faena lo valida quien llama; aquí se escribe y se audita. No
 * escribe la faena.
 */
export async function setVehicleOwnershipTx(
  tx: Tx,
  actor: FleetOwnerActor,
  input: VehicleOwnershipInput,
): Promise<FleetOwnerResult<{ changed: boolean }>> {
  const [vehicle] = await tx.select({
    id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId,
    ownerId: fuelVehicles.ownerId, locationPending: fuelVehicles.locationPendingConfirmation,
  }).from(fuelVehicles).where(eq(fuelVehicles.id, input.vehicleId))
  if (!vehicle) return { ok: false, message: "Vehículo no encontrado." }

  let owner: { id: string; name: string; isActive: boolean } | null = null
  if (input.ownerId) {
    const [row] = await tx.select({ id: fleetOwners.id, name: fleetOwners.name, isActive: fleetOwners.isActive })
      .from(fleetOwners).where(eq(fleetOwners.id, input.ownerId))
    if (!row) return { ok: false, message: "Esa empresa propietaria no existe." }
    if (!row.isActive && row.id !== vehicle.ownerId) return { ok: false, message: `La empresa ${row.name} está inactiva.` }
    owner = row
  }

  const patch: { ownerId?: string | null; locationPendingConfirmation?: boolean } = {}
  const oldState: Record<string, unknown> = {}
  const newState: Record<string, unknown> = {}
  if (input.ownerId !== undefined && (input.ownerId ?? null) !== vehicle.ownerId) {
    patch.ownerId = input.ownerId ?? null
    oldState.ownerId = vehicle.ownerId
    newState.ownerId = patch.ownerId
    if (owner) newState.ownerName = owner.name
  }
  if (input.locationPendingConfirmation !== undefined && input.locationPendingConfirmation !== vehicle.locationPending) {
    patch.locationPendingConfirmation = input.locationPendingConfirmation
    oldState.locationPendingConfirmation = vehicle.locationPending
    newState.locationPendingConfirmation = input.locationPendingConfirmation
  }
  if (Object.keys(patch).length === 0) return { ok: true, message: "No había cambios que guardar.", data: { changed: false } }

  await tx.update(fuelVehicles).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, vehicle.id))
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "update",
    entityType: "fuel_vehicle",
    entityId: vehicle.id,
    entityCode: vehicle.code ?? vehicle.plate,
    oldState,
    newState,
    reason: input.reason,
    worksiteId: vehicle.worksiteId,
  }, tx)
  return { ok: true, message: "Propietario y ubicación guardados.", data: { changed: true } }
}

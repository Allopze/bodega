import { and, asc, count, eq, gte, inArray, isNull, lte, or } from "drizzle-orm"
import { db } from "@/db"
import { clients, contractVehicleAssignments, contracts, fuelEquipmentTypes, fuelVehicles, worksites } from "@/db/schema"
import { todayInChile } from "@/lib/utils"

/**
 * Lo que muestra el detalle de una faena (`/admin/faenas/[id]`): sus contratos
 * con los equipos que hoy trabajan para cada uno, los equipos sin contrato y la
 * lista de equipos que se pueden asignar. Sólo lectura: este servicio no revisa
 * permisos, lo hace la página (`admin:worksites` y alcance de faena).
 */

export type WorksiteContractStatus = "active" | "suspended" | "closed"

export interface WorksiteContractVehicle {
  id: string
  code: string | null
  plate: string | null
  typeName: string
}

export interface WorksiteContractView {
  worksite: { id: string; name: string; code: string }
  contracts: {
    id: string
    code: string
    name: string
    clientId: string
    clientName: string
    startDate: string | null
    endDate: string | null
    status: WorksiteContractStatus
    vehicles: (WorksiteContractVehicle & { validFrom: string })[]
  }[]
  /** Equipos activos de la faena que hoy no pertenecen a ningún contrato. */
  unassignedVehicles: WorksiteContractVehicle[]
  /** Todos los equipos activos de la faena, con el contrato al que hoy pertenecen (si alguno). */
  assignableVehicles: (WorksiteContractVehicle & { currentContractName: string | null })[]
}

/** Orden estable de los equipos: por código interno y, sin él, por patente. */
function byVehicleLabel(a: { code: string | null; plate: string | null }, b: { code: string | null; plate: string | null }): number {
  return (a.code ?? a.plate ?? "").localeCompare(b.code ?? b.plate ?? "", "es", { numeric: true })
}

/**
 * Los contratos de la faena y sus equipos «de hoy»: la asignación cuya vigencia
 * cubre `today` (ambos extremos inclusivos; `valid_to` nulo = sin término).
 * Devuelve `null` si la faena no existe.
 */
export async function getWorksiteContractView(worksiteId: string, today: string = todayInChile()): Promise<WorksiteContractView | null> {
  const [worksite] = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) return null

  const contractRows = await db.select({
    id: contracts.id, code: contracts.code, name: contracts.name, clientId: contracts.clientId, clientName: clients.name,
    startDate: contracts.startDate, endDate: contracts.endDate, status: contracts.status,
  })
    .from(contracts)
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .where(eq(contracts.worksiteId, worksiteId))
    .orderBy(asc(contracts.name), asc(contracts.code))

  const vehicleRows = await db.select({
    id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, typeName: fuelEquipmentTypes.name,
  })
    .from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(eq(fuelVehicles.worksiteId, worksiteId), eq(fuelVehicles.isActive, true)))

  const contractIds = contractRows.map((row) => row.id)
  const assignmentRows = contractIds.length === 0 ? [] : await db.select({
    contractId: contractVehicleAssignments.contractId,
    validFrom: contractVehicleAssignments.validFrom,
    id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, typeName: fuelEquipmentTypes.name,
  })
    .from(contractVehicleAssignments)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, contractVehicleAssignments.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      inArray(contractVehicleAssignments.contractId, contractIds),
      lte(contractVehicleAssignments.validFrom, today),
      or(isNull(contractVehicleAssignments.validTo), gte(contractVehicleAssignments.validTo, today)),
    ))

  const contractNameById = new Map(contractRows.map((row) => [row.id, row.name]))
  const currentContractByVehicle = new Map<string, string>()
  for (const row of assignmentRows) currentContractByVehicle.set(row.id, row.contractId)

  return {
    worksite,
    contracts: contractRows.map((row) => ({
      ...row,
      vehicles: assignmentRows
        .filter((assignment) => assignment.contractId === row.id)
        .map(({ contractId: _contractId, ...vehicle }) => vehicle)
        .sort(byVehicleLabel),
    })),
    unassignedVehicles: vehicleRows
      .filter((vehicle) => !currentContractByVehicle.has(vehicle.id))
      .sort(byVehicleLabel),
    assignableVehicles: vehicleRows
      .map((vehicle) => {
        const contractId = currentContractByVehicle.get(vehicle.id)
        return { ...vehicle, currentContractName: contractId ? contractNameById.get(contractId) ?? null : null }
      })
      .sort(byVehicleLabel),
  }
}

/** Cuántos contratos tiene cada faena (de cualquier estado); las faenas sin contratos no aparecen. */
export async function countContractsByWorksite(worksiteIds: readonly string[]): Promise<Map<string, number>> {
  if (worksiteIds.length === 0) return new Map()
  const rows = await db.select({ worksiteId: contracts.worksiteId, total: count() })
    .from(contracts)
    .where(inArray(contracts.worksiteId, [...worksiteIds]))
    .groupBy(contracts.worksiteId)
  const totals = new Map<string, number>()
  for (const row of rows) if (row.worksiteId) totals.set(row.worksiteId, Number(row.total))
  return totals
}

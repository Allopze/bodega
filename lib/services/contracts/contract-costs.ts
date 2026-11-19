import type { Session } from "next-auth"
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { clients, contracts, worksites } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  attributeCosts,
  emptySums,
  type AssignmentWindow,
  type ComponentSums,
  type CostComponent,
  type DatedCost,
} from "@/lib/contracts/cost-attribution"
import { getFuelBilledByVehicleDay } from "@/lib/combustibles/control/queries/asset-fuel-summary"
import { logger } from "@/lib/logger"
import { canViewPurchaseCosts, canViewWorkOrders } from "@/lib/operational-control/capabilities"
import { listAssignmentWindows } from "@/lib/services/contracts/assignments"
import { workOrderMetricsScope, getWorkOrderCostByVehicleDay } from "@/lib/services/mantencion/work-orders/metrics"
import type { OperationalControlPeriod } from "@/lib/services/operational-control"
import { getVehiclePurchaseByDay, getWorksitePurchasesWithoutVehicle } from "@/lib/services/purchasing-module/vehicle-purchase-summary"

/**
 * Costo por contrato dentro de cada faena (diseño:
 * docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md § 7).
 *
 * No define costo: reparte las partidas por equipo y día que salen de las MISMAS
 * consultas del costo por equipo del Panel operacional (combustible, OT y
 * compras), con `attributeCosts`. Por eso, sumando todas las faenas, cada
 * componente cuadra con la suma de la columna correspondiente del Panel.
 */

export type ContractCostStatus = "active" | "suspended" | "closed"

export interface ContractCostRow {
  kind: "contract" | "unassigned" | "pending" | "no_equipment"
  contractId: string | null
  label: string
  clientName: string | null
  status: ContractCostStatus | null
  vehicleCount: number
  /** `null` = el componente no está disponible para la sesión (sin permiso o su consulta falló). */
  fuel: number | null
  workOrders: number | null
  purchases: number | null
  /** Suma de los componentes disponibles; `null` si no hay ninguno. */
  total: number | null
  /** `true` cuando falta algún componente: el total subestima. */
  partial: boolean
}

export interface WorksiteContractCosts {
  worksiteId: string
  worksiteName: string
  rows: ContractCostRow[]
  total: number | null
  partial: boolean
}

export interface ContractCostBreakdown {
  worksites: WorksiteContractCosts[]
  availability: Record<CostComponent, boolean>
  /** «Faena · Contrato», ordenado por faena y contrato. */
  contractOptions: { id: string; label: string }[]
  /** Ventanas de asignación, para filtrar los equipos activos por contrato. */
  windows: AssignmentWindow[]
}

const COMPONENTS: readonly CostComponent[] = ["fuel", "workOrders", "purchases"]
const collator = new Intl.Collator("es")

function overlapsPeriod(window: AssignmentWindow, period: OperationalControlPeriod): boolean {
  return window.validFrom <= period.to && (window.validTo === null || window.validTo >= period.from)
}

/** Equipos con una ventana del contrato que toca el período. */
export function contractVehicleIds(
  windows: readonly AssignmentWindow[],
  contractId: string,
  period: OperationalControlPeriod,
): Set<string> {
  const ids = new Set<string>()
  for (const window of windows) {
    if (window.contractId === contractId && overlapsPeriod(window, period)) ids.add(window.vehicleId)
  }
  return ids
}

/** Una fuente que falla se registra y se vuelve `null`: ese componente queda «sin dato», no en 0. */
async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    logger.warn(`[costo-por-contrato] la fuente «${label}» falló`, error)
    return null
  }
}

function sumOf(sums: ComponentSums, availability: Record<CostComponent, boolean>): number | null {
  let total = 0
  let any = false
  for (const component of COMPONENTS) {
    if (!availability[component]) continue
    total += sums[component]
    any = true
  }
  return any ? total : null
}

function isZero(sums: ComponentSums): boolean {
  return COMPONENTS.every((component) => sums[component] === 0)
}

export async function getContractCostBreakdown(
  session: Session,
  period: OperationalControlPeriod,
  vehicles: readonly { id: string; worksiteId: string }[],
): Promise<ContractCostBreakdown> {
  // Misma disponibilidad que el hub del Panel.
  const wanted: Record<CostComponent, boolean> = {
    fuel: can(session, "combustibles:view") && can(session, "combustibles:view_costs"),
    workOrders: canViewWorkOrders(session),
    purchases: canViewPurchaseCosts(session),
  }
  const vehicleIds = vehicles.map((vehicle) => vehicle.id)
  const vehicleWorksite = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.worksiteId]))
  const workOrderScope = wanted.workOrders ? workOrderMetricsScope(session) : null

  const scope = resolveWorksiteScope(session)
  const contractRowsPromise = scope.mode === "none"
    ? Promise.resolve([])
    : db.select({
        id: contracts.id,
        name: contracts.name,
        status: contracts.status,
        worksiteId: contracts.worksiteId,
        worksiteName: worksites.name,
        clientName: clients.name,
      })
        .from(contracts)
        .innerJoin(worksites, eq(worksites.id, contracts.worksiteId))
        .leftJoin(clients, eq(clients.id, contracts.clientId))
        .where(scope.mode === "all" ? undefined : inArray(contracts.worksiteId, scope.ids))
        .orderBy(asc(worksites.name), asc(contracts.name))

  const [contractRows, windows, fuel, purchases, workOrders, noEquipment] = await Promise.all([
    contractRowsPromise,
    listAssignmentWindows(vehicleIds, period.from, period.to),
    wanted.fuel ? settle("combustible", () => getFuelBilledByVehicleDay(session, period, vehicleIds)) : [],
    wanted.purchases ? settle("compras", () => getVehiclePurchaseByDay(session, period, vehicleIds)) : [],
    workOrderScope ? settle("órdenes de trabajo", () => getWorkOrderCostByVehicleDay(workOrderScope, { period, vehicleIds })) : [],
    wanted.purchases ? settle("compras sin equipo", () => getWorksitePurchasesWithoutVehicle(session, period)) : new Map<string, number>(),
  ])

  // Una consulta caída deja su componente sin dato en todas las filas.
  const availability: Record<CostComponent, boolean> = {
    fuel: wanted.fuel && fuel !== null,
    workOrders: wanted.workOrders && workOrders !== null,
    purchases: wanted.purchases && purchases !== null,
  }
  const costs: DatedCost[] = [...(fuel ?? []), ...(workOrders ?? []), ...(purchases ?? [])]
  const attribution = attributeCosts({ costs, assignments: windows, vehicleWorksite })

  // Equipos que tocan el período, por contrato y por faena actual.
  const countedByContract = new Map<string, Set<string>>()
  const withWindow = new Set<string>()
  for (const window of windows) {
    if (!overlapsPeriod(window, period)) continue
    withWindow.add(window.vehicleId)
    const set = countedByContract.get(window.contractId)
    if (set) set.add(window.vehicleId)
    else countedByContract.set(window.contractId, new Set([window.vehicleId]))
  }
  const unassignedCount = new Map<string, number>()
  for (const vehicle of vehicles) {
    if (withWindow.has(vehicle.id)) continue
    unassignedCount.set(vehicle.worksiteId, (unassignedCount.get(vehicle.worksiteId) ?? 0) + 1)
  }

  // Sólo las faenas del alcance con al menos un contrato (sin «Sin contrato» que lo sea todo).
  const byWorksite = new Map<string, Array<(typeof contractRows)[number]>>()
  for (const row of contractRows) {
    if (!row.worksiteId) continue
    const list = byWorksite.get(row.worksiteId)
    if (list) list.push(row)
    else byWorksite.set(row.worksiteId, [row])
  }

  const partialAll = COMPONENTS.some((component) => !availability[component])
  const noEquipmentFailed = wanted.purchases && noEquipment === null

  const toRow = (
    base: Pick<ContractCostRow, "kind" | "contractId" | "label" | "clientName" | "status" | "vehicleCount">,
    sums: ComponentSums,
  ): ContractCostRow => ({
    ...base,
    fuel: availability.fuel ? sums.fuel : null,
    workOrders: availability.workOrders ? sums.workOrders : null,
    purchases: availability.purchases ? sums.purchases : null,
    total: sumOf(sums, availability),
    partial: partialAll,
  })

  const worksiteResults: WorksiteContractCosts[] = []
  const contractOptions: { id: string; label: string }[] = []

  for (const [worksiteId, list] of byWorksite) {
    const worksiteName = list[0]?.worksiteName ?? ""
    const attr = attribution.get(worksiteId)
    const rows: ContractCostRow[] = []

    for (const contract of list) {
      contractOptions.push({ id: contract.id, label: `${worksiteName} · ${contract.name}` })
      const sums = attr?.contracts.get(contract.id) ?? emptySums()
      const count = countedByContract.get(contract.id)?.size ?? 0
      const shown = contract.status === "active" || count > 0 || !isZero(sums)
      if (!shown) continue
      rows.push(toRow({
        kind: "contract",
        contractId: contract.id,
        label: contract.name,
        clientName: contract.clientName ?? null,
        status: contract.status,
        vehicleCount: count,
      }, sums))
    }
    rows.sort((a, b) => collator.compare(a.label, b.label))

    if (attr && !isZero(attr.unassigned)) {
      rows.push(toRow({
        kind: "unassigned", contractId: null, label: "Sin contrato", clientName: null, status: null,
        vehicleCount: unassignedCount.get(worksiteId) ?? 0,
      }, attr.unassigned))
    }
    if (attr && !isZero(attr.pending)) {
      rows.push(toRow({
        kind: "pending", contractId: null, label: "Por repartir", clientName: null, status: null, vehicleCount: 0,
      }, attr.pending))
    }
    const withoutEquipment = availability.purchases ? (noEquipment?.get(worksiteId) ?? 0) : 0
    if (withoutEquipment !== 0) {
      rows.push({
        kind: "no_equipment", contractId: null, label: "Compras sin equipo", clientName: null, status: null, vehicleCount: 0,
        fuel: null, workOrders: null, purchases: withoutEquipment, total: withoutEquipment, partial: false,
      })
    }

    const totals = rows.map((row) => row.total).filter((value): value is number => value !== null)
    worksiteResults.push({
      worksiteId,
      worksiteName,
      rows,
      total: totals.length > 0 ? totals.reduce((acc, value) => acc + value, 0) : null,
      partial: partialAll || noEquipmentFailed,
    })
  }

  worksiteResults.sort((a, b) => collator.compare(a.worksiteName, b.worksiteName))
  contractOptions.sort((a, b) => collator.compare(a.label, b.label))
  return { worksites: worksiteResults, availability, contractOptions, windows: [...windows] }
}

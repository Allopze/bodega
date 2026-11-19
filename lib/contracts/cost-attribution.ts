/**
 * Atribución del costo por equipo a contratos (sin acceso a base de datos).
 *
 * Diseño: docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md § 7.
 * Plan: docs/superpowers/plans/2026-11-18-contratos-por-faena.md, Task 2.
 *
 * Cada partida de costo trae su día; va al contrato que el equipo tenía ese día.
 * Nada se prorratea: un agregado mensual que cruza un cambio de contrato queda
 * «Por repartir».
 */

export type CostComponent = "fuel" | "workOrders" | "purchases"

/** Una partida de costo de un equipo en un día (o en un mes, si `spansMonth`). */
export interface DatedCost {
  vehicleId: string
  /** Día civil `YYYY-MM-DD`. Para un agregado mensual, el día 1 del mes. */
  day: string
  amount: number
  component: CostComponent
  /** `true` = agregado mensual del proveedor (TCT): cubre el mes de `day`. */
  spansMonth: boolean
}

/** Vigencia de una asignación equipo → contrato; ambos extremos inclusivos. */
export interface AssignmentWindow {
  vehicleId: string
  contractId: string
  /** Faena del contrato. */
  worksiteId: string
  validFrom: string
  validTo: string | null
}

export type ComponentSums = Record<CostComponent, number>

export interface WorksiteAttribution {
  contracts: Map<string, ComponentSums>
  unassigned: ComponentSums
  pending: ComponentSums
}

export function emptySums(): ComponentSums {
  return { fuel: 0, workOrders: 0, purchases: 0 }
}

function nuevaAtribucion(): WorksiteAttribution {
  return { contracts: new Map(), unassigned: emptySums(), pending: emptySums() }
}

/** Último día civil del mes de `day` (`YYYY-MM-DD`), en el mismo formato. */
function ultimoDiaDelMes(day: string): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`
}

function cubre(w: AssignmentWindow, day: string): boolean {
  return w.validFrom <= day && (w.validTo === null || day <= w.validTo)
}

/**
 * Reparte cada partida de costo en la faena y la cubeta que le corresponde.
 * Clave del resultado: `worksiteId`. Nada se prorratea (ver el encabezado).
 */
export function attributeCosts(input: {
  costs: readonly DatedCost[]
  assignments: readonly AssignmentWindow[]
  /** Faena ACTUAL de cada equipo. */
  vehicleWorksite: ReadonlyMap<string, string>
}): Map<string, WorksiteAttribution> {
  const result = new Map<string, WorksiteAttribution>()
  const windowsByVehicle = new Map<string, AssignmentWindow[]>()
  for (const w of input.assignments) {
    const list = windowsByVehicle.get(w.vehicleId)
    if (list) list.push(w)
    else windowsByVehicle.set(w.vehicleId, [w])
  }

  const of = (worksiteId: string): WorksiteAttribution => {
    let a = result.get(worksiteId)
    if (!a) {
      a = nuevaAtribucion()
      result.set(worksiteId, a)
    }
    return a
  }
  const toContract = (w: AssignmentWindow, c: DatedCost) => {
    const a = of(w.worksiteId)
    let sums = a.contracts.get(w.contractId)
    if (!sums) {
      sums = emptySums()
      a.contracts.set(w.contractId, sums)
    }
    sums[c.component] += c.amount
  }

  for (const c of input.costs) {
    const current = input.vehicleWorksite.get(c.vehicleId)
    if (current === undefined) throw new Error(`Equipo sin faena: ${c.vehicleId}`)
    const windows = windowsByVehicle.get(c.vehicleId) ?? []

    if (!c.spansMonth) {
      const w = windows.find((x) => cubre(x, c.day))
      if (w) toContract(w, c)
      else of(current).unassigned[c.component] += c.amount
      continue
    }

    // Agregado mensual: el mes completo de `c.day`.
    const monthStart = `${c.day.slice(0, 7)}-01`
    const monthEnd = ultimoDiaDelMes(c.day)
    const overlapping = windows.filter(
      (x) => x.validFrom <= monthEnd && (x.validTo === null || x.validTo >= monthStart),
    )
    const [only] = overlapping
    if (!only) {
      of(current).unassigned[c.component] += c.amount
      continue
    }
    if (
      overlapping.length === 1 &&
      only.validFrom <= monthStart &&
      (only.validTo === null || only.validTo >= monthEnd)
    ) {
      toContract(only, c)
      continue
    }
    const shared = overlapping.every((x) => x.worksiteId === only.worksiteId)
    of(shared ? only.worksiteId : current).pending[c.component] += c.amount
  }

  return result
}

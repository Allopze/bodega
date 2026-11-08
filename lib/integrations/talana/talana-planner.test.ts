import { describe, expect, it } from "vitest"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import {
  findBajaCandidates, planTalanaSync,
  type PersonPlan, type PlannerBase, type PlannerContract, type PlannerInput, type PlannerPosition, type PlannerWorker,
} from "./talana-planner"

const TODAY = "2026-11-08"
const EMPLOYER = "SERVICIOS INDUSTRIALES CHOME LTDA"

function position(id: string, name: string, extra: Partial<PlannerPosition> = {}): PlannerPosition {
  return { id, name, isSystem: false, isActive: true, keys: [normalizeWorkerPositionKey(name)], ...extra }
}

const POSITIONS: PlannerPosition[] = [
  position("pos-unc", "Sin clasificar", { isSystem: true }),
  position("pos-cond", "Conductor de camión"),
  position("pos-op", "Operador de maquinaria"),
  position("pos-sup", "Supervisor"),
]
const WORKSITES = [
  { id: "ws-cho", name: "Cholguan - Arauco", isActive: true },
  { id: "ws-bio", name: "Biodiversa", isActive: true },
  { id: "ws-of", name: "Oficina Central", isActive: true },
]

let nextId = 1000
function contract(rut: string, extra: Partial<PlannerContract> = {}): PlannerContract {
  return {
    id: nextId++, rut, rutValid: true, firstName: "JUAN", lastNamePaternal: "PEREZ", lastNameMaternal: "SOTO", sex: "M",
    employerName: EMPLOYER, contractType: "Indefinido", cargo: "CHOFER", costCenterId: 1, costCenterName: "CHOLGUAN MAQUINAS",
    jefeRut: null, jefeName: null, hiredOn: "2024-01-10", startsOn: "2024-01-10", endsOn: null, finiquitado: false,
    listedActive: true, activationProcessedAt: null, finiquitoProcessedAt: null, ...extra,
  }
}

function worker(id: string, rut: string | null, extra: Partial<PlannerWorker> = {}): PlannerWorker {
  return {
    id, rut, firstName: "Juan", lastName: "Pérez Soto", sex: "male", positionId: "pos-cond", supervisor: null,
    worksiteId: "ws-cho", isActive: true, createdOn: "2025-01-01", ...extra,
  }
}

function input(extra: Partial<PlannerInput>): PlannerInput {
  return {
    today: TODAY, contracts: [], workers: [], positions: POSITIONS, worksites: WORKSITES, bases: new Map(),
    lastActivityByWorker: new Map(), unclassifiedPositionId: "pos-unc", ...extra,
  }
}

function only(result: ReturnType<typeof planTalanaSync>, rut: string): PersonPlan {
  const plan = result.persons.find((person) => person.rut === rut)
  if (!plan) throw new Error(`sin plan para ${rut}`)
  return plan
}

const base = (extra: Partial<PlannerBase>): PlannerBase => ({
  cargoKey: null, positionId: null, costCenterId: null, worksiteId: null, jefeKey: null, supervisor: null, ...extra,
})

describe("altas", () => {
  it("crea a quien tiene contrato activo nuevo y no existe en Chome", () => {
    const result = planTalanaSync(input({ contracts: [contract("11111111-1")] }))
    const plan = only(result, "11111111-1")
    expect(plan.create).toMatchObject({ firstName: "Juan", lastName: "Perez Soto", sex: "male", positionId: "pos-cond", worksiteId: "ws-cho" })
    expect(plan.markActivation).toHaveLength(1)
    expect(plan.recentHire).toBe(false)
    expect(result.plannedAltas).toBe(1)
  })

  it("marca el ingreso reciente (≤30 días) para abrir la inducción del PDTP", () => {
    const plan = only(planTalanaSync(input({ contracts: [contract("11111111-1", { hiredOn: "2026-10-20" })] })), "11111111-1")
    expect(plan.recentHire).toBe(true)
  })

  it("no crea si el centro de costo no tiene faena", () => {
    const plan = only(planTalanaSync(input({ contracts: [contract("11111111-1", { costCenterName: "CALYMAG" })] })), "11111111-1")
    expect(plan.create).toBeNull()
    expect(plan.markActivation).toHaveLength(0)
    expect(plan.items).toEqual([expect.objectContaining({ kind: "alta", outcome: "skipped", reasonCode: "faena_sin_mapeo" })])
  })

  it("no crea si ya hay alguien con el mismo nombre y otro RUT (o sin RUT)", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("11111111-1")],
      workers: [worker("w-otro", null, { firstName: "Juan Andrés", lastName: "Pérez Soto" })],
    })), "11111111-1")
    expect(plan.create).toBeNull()
    expect(plan.items[0]).toMatchObject({ reasonCode: "posible_duplicado" })
  })

  it("un contrato ya procesado no vuelve a crear", () => {
    const result = planTalanaSync(input({ contracts: [contract("11111111-1", { activationProcessedAt: "2026-11-01T00:00:00Z" })] }))
    expect(result.persons).toHaveLength(0)
  })

  it("cargo sin equivalencia queda Sin clasificar", () => {
    const plan = only(planTalanaSync(input({ contracts: [contract("11111111-1", { cargo: "ASTRONAUTA" })] })), "11111111-1")
    expect(plan.create?.positionId).toBe("pos-unc")
  })

  it("ignora contratos de otras razones sociales", () => {
    const result = planTalanaSync(input({ contracts: [contract("11111111-1", { employerName: "AGRICOLA FLOR DEL LAJA" })] }))
    expect(result.persons).toHaveLength(0)
  })
})

describe("reactivaciones", () => {
  it("reactiva a un inactivo cuyo contrato activo es nuevo, en la faena de Talana", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("22222222-2", { costCenterName: "BIODIVERSA", costCenterId: 2 })],
      workers: [worker("w2", "22222222-2", { isActive: false })],
    })), "22222222-2")
    expect(plan.reactivate).toEqual({ worksiteId: "ws-bio" })
  })

  it("no reactiva si el contrato ya fue procesado (alguien lo desactivó a mano)", () => {
    const result = planTalanaSync(input({
      contracts: [contract("22222222-2", { activationProcessedAt: "2026-10-01T00:00:00Z" })],
      workers: [worker("w2", "22222222-2", { isActive: false })],
    }))
    expect(result.persons).toHaveLength(0)
  })
})

describe("bajas", () => {
  const finiquitado = (rut: string, extra: Partial<PlannerContract> = {}) =>
    contract(rut, { listedActive: false, finiquitado: true, endsOn: "2026-10-15", ...extra })

  it("da de baja a un activo con todos sus contratos finiquitados y término pasado", () => {
    const plan = only(planTalanaSync(input({ contracts: [finiquitado("33333333-3")], workers: [worker("w3", "33333333-3")] })), "33333333-3")
    expect(plan.deactivate).toEqual({ endsOn: "2026-10-15" })
    expect(plan.markFiniquito).toHaveLength(1)
    expect(plan.resetActivation).toHaveLength(1)
  })

  it("un plazo vencido SIN finiquito no es baja", () => {
    const result = planTalanaSync(input({
      contracts: [contract("33333333-3", { listedActive: false, finiquitado: false, endsOn: "2026-10-23", contractType: "Plazo Fijo" })],
      workers: [worker("w3", "33333333-3")],
    }))
    expect(result.persons).toHaveLength(0)
  })

  it("no figurar en Talana no es baja", () => {
    expect(planTalanaSync(input({ workers: [worker("w3", "33333333-3")] })).persons).toHaveLength(0)
  })

  it("no da de baja si hay actividad en Chome posterior al término", () => {
    const plan = only(planTalanaSync(input({
      contracts: [finiquitado("33333333-3")],
      workers: [worker("w3", "33333333-3")],
      lastActivityByWorker: new Map([["w3", "2026-10-20"]]),
    })), "33333333-3")
    expect(plan.deactivate).toBeNull()
    expect(plan.items[0]).toMatchObject({ kind: "baja", outcome: "skipped", reasonCode: "actividad_posterior" })
    expect(plan.markFiniquito).toHaveLength(1)
  })

  it("no da de baja si la ficha se creó después del término", () => {
    const plan = only(planTalanaSync(input({
      contracts: [finiquitado("33333333-3")],
      workers: [worker("w3", "33333333-3", { createdOn: "2026-10-30" })],
    })), "33333333-3")
    expect(plan.deactivate).toBeNull()
    expect(plan.items[0]).toMatchObject({ reasonCode: "creado_despues_del_termino" })
  })

  it("no da de baja si tiene otro contrato activo, o uno sin finiquitar", () => {
    const active = planTalanaSync(input({
      contracts: [finiquitado("33333333-3"), contract("33333333-3")],
      workers: [worker("w3", "33333333-3")],
    }))
    expect(active.persons.find((person) => person.deactivate)).toBeUndefined()
    const pending = planTalanaSync(input({
      contracts: [finiquitado("33333333-3"), contract("33333333-3", { listedActive: false, endsOn: "2026-09-01" })],
      workers: [worker("w3", "33333333-3")],
    }))
    expect(pending.persons).toHaveLength(0)
  })

  it("no da de baja con término de hoy o futuro, ni un finiquito ya procesado", () => {
    expect(planTalanaSync(input({ contracts: [finiquitado("33333333-3", { endsOn: TODAY })], workers: [worker("w3", "33333333-3")] })).persons).toHaveLength(0)
    expect(planTalanaSync(input({
      contracts: [finiquitado("33333333-3", { finiquitoProcessedAt: "2026-10-20T00:00:00Z" })],
      workers: [worker("w3", "33333333-3")],
    })).persons).toHaveLength(0)
  })

  it("un finiquito de alguien que no está activo en Chome sólo se marca procesado", () => {
    const plan = only(planTalanaSync(input({ contracts: [finiquitado("33333333-3")] })), "33333333-3")
    expect(plan.deactivate).toBeNull()
    expect(plan.markFiniquito).toHaveLength(1)
    expect(plan.items).toHaveLength(0)
  })

  it("findBajaCandidates sólo devuelve a quien llega a la guarda de actividad", () => {
    expect(findBajaCandidates({ today: TODAY, contracts: [finiquitado("33333333-3")], workers: [worker("w3", "33333333-3")] })).toEqual(["w3"])
    expect(findBajaCandidates({ today: TODAY, contracts: [contract("33333333-3")], workers: [worker("w3", "33333333-3")] })).toEqual([])
  })
})

describe("campos: completar vacíos y merge a tres bandas", () => {
  it("primera corrida: completa cargo Sin clasificar, sexo y jefe vacíos", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("44444444-4", { jefeRut: "55555555-5", jefeName: "PEDRO ROJAS" })],
      workers: [
        worker("w4", "44444444-4", { positionId: "pos-unc", sex: null, supervisor: null }),
        worker("w5", "55555555-5", { firstName: "Pedro Pablo", lastName: "Rojas" }),
      ],
    })), "44444444-4")
    expect(plan.changes).toEqual({ positionId: "pos-cond", sex: "male", supervisor: "Pedro Pablo Rojas" })
    expect(plan.items.find((item) => item.kind === "sexo")).toMatchObject({ before: null, after: null })
    expect(plan.nextBase).toMatchObject({ cargoKey: "CHOFER", positionId: "pos-cond", costCenterId: 1, worksiteId: "ws-cho", jefeKey: "55555555-5" })
  })

  it("primera corrida: no pisa un cargo o una faena distintos; los anota una vez", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("44444444-4", { costCenterName: "BIODIVERSA", costCenterId: 2 })],
      workers: [worker("w4", "44444444-4", { positionId: "pos-op" })],
    })), "44444444-4")
    expect(plan.changes).toEqual({})
    expect(plan.items.map((item) => [item.kind, item.reasonCode])).toEqual([["cargo", "cargo_distinto"], ["traslado", "faena_distinta"]])
    // La base avanza: la próxima corrida ya no lo anota.
    expect(plan.nextBase).toMatchObject({ cargoKey: "CHOFER", costCenterId: 2 })
  })

  it("sigue un cambio de Talana si Chome todavía tiene lo que mapeaba la base", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("44444444-4", { cargo: "OPERADOR", costCenterName: "BIODIVERSA", costCenterId: 2 })],
      workers: [worker("w4", "44444444-4", { positionId: "pos-cond", worksiteId: "ws-cho" })],
      bases: new Map([["44444444-4", base({ cargoKey: "CHOFER", positionId: "pos-cond", costCenterId: 1, worksiteId: "ws-cho" })]]),
    })), "44444444-4")
    expect(plan.changes).toEqual({ positionId: "pos-op", worksiteId: "ws-bio" })
  })

  it("respeta un cambio hecho a mano en Chome", () => {
    const plan = only(planTalanaSync(input({
      contracts: [contract("44444444-4", { cargo: "OPERADOR" })],
      workers: [worker("w4", "44444444-4", { positionId: "pos-sup" })],
      bases: new Map([["44444444-4", base({ cargoKey: "CHOFER", positionId: "pos-cond", costCenterId: 1, worksiteId: "ws-cho" })]]),
    })), "44444444-4")
    expect(plan.changes.positionId).toBeUndefined()
    expect(plan.items[0]).toMatchObject({ kind: "cargo", outcome: "skipped", reasonCode: "cambio_manual_en_chome" })
  })

  it("si Talana no cambió y Chome difiere, no hace nada (ni anota)", () => {
    const result = planTalanaSync(input({
      contracts: [contract("44444444-4", { activationProcessedAt: "2026-11-01T00:00:00Z" })],
      workers: [worker("w4", "44444444-4", { positionId: "pos-sup" })],
      bases: new Map([["44444444-4", base({ cargoKey: "CHOFER", positionId: "pos-cond", costCenterId: 1, worksiteId: "ws-cho" })]]),
    }))
    expect(result.persons).toHaveLength(0)
  })

  it("dos centros de costo de la misma faena no son traslado", () => {
    const result = planTalanaSync(input({
      contracts: [contract("44444444-4", { costCenterName: "CHOLGUAN RESIDUOS", costCenterId: 9, activationProcessedAt: "2026-11-01T00:00:00Z" })],
      workers: [worker("w4", "44444444-4")],
      bases: new Map([["44444444-4", base({ cargoKey: "CHOFER", positionId: "pos-cond", costCenterId: 1, worksiteId: "ws-cho" })]]),
    }))
    const plan = result.persons[0]
    expect(plan?.changes.worksiteId).toBeUndefined()
  })

  it("un cargo nuevo de Talana se resuelve por alias del catálogo", () => {
    const positions = POSITIONS.map((p) => (p.id === "pos-op" ? { ...p, keys: [...p.keys, normalizeWorkerPositionKey("Operador de grúa horquilla")] } : p))
    const plan = only(planTalanaSync(input({
      positions,
      contracts: [contract("44444444-4", { cargo: "OPERADOR DE GRUA HORQUILLA" })],
      workers: [worker("w4", "44444444-4", { positionId: "pos-unc" })],
    })), "44444444-4")
    expect(plan.changes.positionId).toBe("pos-op")
  })

  it("no cambia campos de un trabajador inactivo", () => {
    const result = planTalanaSync(input({
      contracts: [contract("44444444-4", { activationProcessedAt: "2026-11-01T00:00:00Z" })],
      workers: [worker("w4", "44444444-4", { isActive: false, positionId: "pos-unc", sex: null })],
    }))
    expect(result.persons).toHaveLength(0)
  })
})

describe("casos que no se tocan", () => {
  it("RUT repetido en Chome o RUT inválido en Talana", () => {
    expect(planTalanaSync(input({
      contracts: [contract("44444444-4")],
      workers: [worker("a", "44444444-4"), worker("b", "44444444-4")],
    })).persons).toHaveLength(0)
    expect(planTalanaSync(input({ contracts: [contract("44444444-0", { rutValid: false })] })).persons).toHaveLength(0)
  })

  it("el jefe que es la misma persona no se asigna", () => {
    const plan = only(planTalanaSync(input({ contracts: [contract("44444444-4", { jefeRut: "44444444-4", jefeName: "JUAN PEREZ" })] })), "44444444-4")
    expect(plan.create?.supervisor).toBeNull()
  })
})

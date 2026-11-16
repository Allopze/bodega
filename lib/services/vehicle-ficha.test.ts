import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Quién ve qué pestaña de la ficha única del vehículo (crítica 2026-11-15, paso 4a). Las tres
 * fichas que reemplaza pedían permisos distintos; la ficha única no puede ampliar ni recortar lo
 * que cada perfil veía: permiso del área, módulo encendido y faena del vehículo en su alcance.
 */

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  disabledRoutes: [] as string[],
}))

vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {}
  for (const method of ["select", "from", "innerJoin", "leftJoin", "where"]) chain[method] = () => chain
  chain.limit = async () => (state.row ? [state.row] : [])
  return { db: chain }
})
vi.mock("@/lib/services/module-toggles", () => ({
  getNavigationToggleState: async () => ({ enabledModuleIds: new Set(), disabledSubmoduleHrefs: new Set() }),
  routeIsEnabled: (pathname: string) => !state.disabledRoutes.includes(pathname),
}))

import { fichaTabsFor, loadVehicleFichaContext } from "./vehicle-ficha"

function session(permissions: string[], options: { worksiteIds?: string[]; isGlobal?: boolean } = {}): Session {
  return {
    user: { id: "u1", email: "u1@example.com", permissions, worksiteIds: options.worksiteIds ?? [], isGlobal: options.isGlobal ?? false, roles: [] },
    expires: "2099-01-01",
  } as unknown as Session
}

function vehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "veh-1", code: "KA-115", plate: "RBYD-98", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Santa Fe",
    operationalStatus: "operativo", isActive: true, profileVehicleId: "veh-1", noPlate: false,
    fleetBrand: "VOLVO FH", maintenanceBrand: "Volvo",
    ...overrides,
  }
}

const JEFATURA = session(["flota:view", "mant:records:view_all", "mant:records:view_worksite", "combustibles:view"], { isGlobal: true })
const SUPERVISOR_MANTENCION = session(["mant:records:view_own", "mant:records:view_worksite", "mant:app:use"], { worksiteIds: ["ws-1"] })
const ADMIN_CONTRATO = session(["combustibles:view", "mant:ot:view_worksite", "flota:manage_licenses", "admin:fleet_vehicles"], { worksiteIds: ["ws-1"] })

beforeEach(() => {
  state.row = vehicle()
  state.disabledRoutes = []
})

describe("ficha única: pestañas por perfil", () => {
  it("jefatura ve las tres áreas y el Resumen", async () => {
    const ctx = await loadVehicleFichaContext(JEFATURA, "veh-1")
    expect(ctx?.areas).toEqual(["flota", "mantencion", "combustible"])
    expect(ctx?.tabs).toEqual(["resumen", "flota", "mantencion", "combustible"])
  })

  it("supervisor de mantención sólo ve Mantención: sin pestañas ni Resumen", async () => {
    const ctx = await loadVehicleFichaContext(SUPERVISOR_MANTENCION, "veh-1")
    expect(ctx?.areas).toEqual(["mantencion"])
    expect(ctx?.tabs).toEqual(["mantencion"])
  })

  it("administración de contrato sólo ve Combustible, aunque tenga el padrón y las OT de su faena", async () => {
    const ctx = await loadVehicleFichaContext(ADMIN_CONTRATO, "veh-1")
    expect(ctx?.areas).toEqual(["combustible"])
    expect(ctx?.tabs).toEqual(["combustible"])
  })

  it("con permiso pero de otra faena no ve el área: la distingue de «sin permiso» para responder 404", async () => {
    state.row = vehicle({ worksiteId: "ws-2" })
    const ctx = await loadVehicleFichaContext(SUPERVISOR_MANTENCION, "veh-1")
    expect(ctx?.permittedAreas).toEqual(["mantencion"])
    expect(ctx?.areas).toEqual([])
  })

  it("un módulo apagado saca su pestaña aunque el permiso siga concedido", async () => {
    state.disabledRoutes = ["/combustibles/consumo"]
    const ctx = await loadVehicleFichaContext(JEFATURA, "veh-1")
    expect(ctx?.permittedAreas).toEqual(["flota", "mantencion"])
    expect(ctx?.tabs).toEqual(["resumen", "flota", "mantencion"])
  })

  it("un vehículo que no existe no tiene contexto", async () => {
    state.row = null
    expect(await loadVehicleFichaContext(JEFATURA, "nada")).toBeNull()
  })
})

describe("ficha única: el vehículo", () => {
  it("se nombra por su código y, sin él, por la patente", async () => {
    expect((await loadVehicleFichaContext(JEFATURA, "veh-1"))?.label).toBe("KA-115")
    state.row = vehicle({ code: "  " })
    expect((await loadVehicleFichaContext(JEFATURA, "veh-1"))?.label).toBe("RBYD-98")
  })

  it("sin perfil de Mantención lo dice, para que la pestaña muestre cómo incorporarlo", async () => {
    state.row = vehicle({ profileVehicleId: null, noPlate: null })
    const ctx = await loadVehicleFichaContext(JEFATURA, "veh-1")
    expect(ctx?.hasMaintenanceProfile).toBe(false)
    expect(ctx?.vehicle.noPlate).toBe(false)
    // La pestaña sigue: el permiso y la faena mandan, no el perfil.
    expect(ctx?.areas).toContain("mantencion")
  })
})

describe("ficha única: identidad en un solo lugar (paso 4b)", () => {
  it("la marca es la de la lista de Mantención si está en ella; si no, la del padrón", async () => {
    expect((await loadVehicleFichaContext(JEFATURA, "veh-1"))?.vehicle.brand).toBe("Volvo")
    state.row = vehicle({ profileVehicleId: null, noPlate: null, maintenanceBrand: null, fleetBrand: " VOLVO FH " })
    expect((await loadVehicleFichaContext(JEFATURA, "veh-1"))?.vehicle.brand).toBe("VOLVO FH")
  })

  it("«Editar vehículo» exige el padrón y la faena del vehículo en el alcance", async () => {
    expect((await loadVehicleFichaContext(JEFATURA, "veh-1"))?.canEditVehicle).toBe(false)
    const padron = session(["flota:view", "admin:fleet_vehicles"], { worksiteIds: ["ws-1"] })
    expect((await loadVehicleFichaContext(padron, "veh-1"))?.canEditVehicle).toBe(true)
    state.row = vehicle({ worksiteId: "ws-2" })
    expect((await loadVehicleFichaContext(padron, "veh-1"))?.canEditVehicle).toBe(false)
  })
})

describe("fichaTabsFor", () => {
  it("el Resumen sólo existe con dos áreas o más", () => {
    expect(fichaTabsFor([])).toEqual([])
    expect(fichaTabsFor(["combustible"])).toEqual(["combustible"])
    expect(fichaTabsFor(["flota", "combustible"])).toEqual(["resumen", "flota", "combustible"])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/**
 * `getOperationalControlHub` devuelve, además de las métricas del período, los
 * conteos de «Requiere atención» (hoy, sin período). Aquí se fijan tres cosas:
 *
 *  - cada conteo sólo se consulta con la capacidad de su dominio;
 *  - cada cifra sale de las filas con el criterio de la lista a la que enlaza;
 *  - un conteo que falla queda en `null` y no tumba el resto del panel.
 *
 * La base se reemplaza por una cadena que resuelve por tabla: lo que se verifica
 * es qué consultas se emiten y cómo se interpretan, no el SQL.
 */

const mocks = vi.hoisted(() => ({
  rowsByQuery: new Map<string, unknown[]>(),
  failing: new Set<string>(),
  issued: [] as string[],
  logError: vi.fn(),
  fleetSettings: vi.fn(async () => ({ warningDays: 30, defaultVehicleStatus: "operativo" })),
}))

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm")
  const select = (_projection: Record<string, unknown>) => {
    let key = ""
    const chain: Record<string, unknown> = {}
    chain.from = (table: Parameters<typeof getTableName>[0]) => {
      key = getTableName(table)
      mocks.issued.push(key)
      return chain
    }
    for (const method of ["innerJoin", "leftJoin", "where", "orderBy", "groupBy", "limit"]) {
      chain[method] = () => chain
    }
    chain.then = (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
      mocks.failing.has(key)
        ? Promise.reject(new Error(`falla simulada: ${key}`)).then(resolve, reject)
        : Promise.resolve(mocks.rowsByQuery.get(key) ?? []).then(resolve, reject)
    return chain
  }
  return {
    db: {
      select,
      selectDistinctOn: (_distinct: unknown[], projection: Record<string, unknown>) => select(projection),
    },
  }
})

// El hub sólo usa `can`; el módulo real arrastra next-auth y las cabeceras de Next.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

vi.mock("@/lib/services/system-settings", () => ({
  getFleetAdminSettings: mocks.fleetSettings,
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { getOperationalControlHub } from "@/lib/services/operational-control"

function session(...permissions: string[]): Session {
  return { user: { id: "u1", permissions, isGlobal: true, worksiteIds: [] } } as unknown as Session
}

function vehicleRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: null,
    plate: `PL-${id}`,
    type: "Camioneta",
    worksiteId: "ws-1",
    worksiteName: "Faena Norte",
    operationalStatus: "operativo",
    isActive: true,
    soapExpiresAt: null,
    technicalReviewExpiresAt: null,
    circulationPermitExpiresAt: null,
    insuranceExpiresAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.rowsByQuery.clear()
  mocks.failing.clear()
  mocks.issued.length = 0
  mocks.logError.mockClear()
  mocks.fleetSettings.mockClear()
  vi.useFakeTimers()
  // 15:00 UTC = 12:00 en Chile: hoy es 2026-10-22 y la ventana de aviso (30 días) termina el 2026-11-21.
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"))
  mocks.rowsByQuery.set("fuel_vehicles", [
    vehicleRow("operativo"),
    vehicleRow("en-mantencion", { operationalStatus: "mantencion", soapExpiresAt: "2026-10-21" }),
    vehicleRow("fuera", { operationalStatus: "fuera_servicio", technicalReviewExpiresAt: "2026-11-21" }),
    // Dado de baja pero con el estado que dejó: la lista de flota lo cuenta, así que el tile también.
    vehicleRow("de-baja", { operationalStatus: "mantencion", isActive: false }),
    vehicleRow("solo-documento"),
  ])
  mocks.rowsByQuery.set("fleet_vehicle_documents", [
    { vehicleId: "solo-documento", documentType: "Seguro", expiresAt: "2026-09-30" },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getOperationalControlHub · atención", () => {
  it("entrega los dos conteos con la sesión que ve flota", async () => {
    const hub = await getOperationalControlHub(session("flota:view"))

    expect(hub.attention.stoppedVehicles).toEqual({ total: 3, inMaintenance: 2, outOfService: 1 })
    expect(hub.attention.fleetDocuments).toEqual({
      warningDays: 30,
      // en-mantencion (ayer) y solo-documento (seguro vigente vencido) vencen antes de hoy;
      // `fuera` vence el último día de la ventana.
      expired: 2,
      expiringSoon: 1,
    })
    // Por defecto (la página) las consultas de atención sí se emiten.
    expect(mocks.issued).toContain("fleet_vehicle_documents")
    expect(mocks.fleetSettings).toHaveBeenCalled()
  })

  it("includeAttention: false (la exportación) no consulta ajustes, pero sí los documentos del activo", async () => {
    const hub = await getOperationalControlHub(
      session("flota:view"),
      {},
      { includeAttention: false },
    )

    expect(hub.attention).toEqual({ stoppedVehicles: null, fleetDocuments: null })
    // Los documentos alimentan el próximo vencimiento de la fila, no sólo el tile.
    expect(mocks.issued).toContain("fleet_vehicle_documents")
    expect(mocks.fleetSettings).not.toHaveBeenCalled()
    // Lo que la exportación sí usa sigue llegando.
    expect(mocks.issued).toContain("fuel_vehicles")
    expect(hub.assets).toHaveLength(5)
    expect(hub.metrics).toBeDefined()
  })

  it("no consulta ni devuelve lo que la sesión no puede ver", async () => {
    const inspectionsOnly = await getOperationalControlHub(session("prevention:inspections:view"))
    expect(inspectionsOnly.attention.stoppedVehicles).toBeNull()
    expect(inspectionsOnly.attention.fleetDocuments).toBeNull()
    expect(mocks.issued).not.toContain("fleet_vehicle_documents")
    expect(mocks.fleetSettings).not.toHaveBeenCalled()
  })

  it("un conteo que falla queda en null y no tumba el panel ni los demás conteos", async () => {
    mocks.failing.add("fleet_vehicle_documents")

    const hub = await getOperationalControlHub(session("flota:view"))

    expect(hub.attention.fleetDocuments).toBeNull()
    expect(hub.attention.stoppedVehicles?.total).toBe(3)
    expect(hub.assets).toHaveLength(5)
    expect(hub.degradedSources).toEqual(expect.arrayContaining(["documentos de flota"]))
    expect(mocks.logError).toHaveBeenCalledTimes(1)
  })

  it("un permiso retirado con el módulo de mantenciones ya no abre el panel", async () => {
    await expect(getOperationalControlHub(session("mantenciones:view"))).rejects.toThrow("Sin permisos para Control operacional")
  })
})

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

    expect(hub.attention).toEqual({ stoppedVehicles: null, fleetDocuments: null, workOrders: null })
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

  describe("órdenes de trabajo", () => {
    // Una sola fila sirve a las dos consultas (por equipo y global): lleva los campos de ambas.
    const otRow = {
      vehicleId: "en-mantencion", openCount: 3, unassignedOpen: 1, inWorkshopNow: 1, closedInPeriod: 2,
      workshopHoursInPeriod: 30, repairClosedInPeriod: 2, repairClosedWorkshopHours: 40,
      lastExitAt: null, lastClosedWorkOrderId: null, estimateOverdue: 1,
    }

    it("sin mant:ot:view_* no consulta OT y deja sus cifras en null (entrar al panel no las habilita)", async () => {
      const hub = await getOperationalControlHub(session("flota:view"))

      expect(mocks.issued).not.toContain("mant_work_orders")
      expect(hub.attention.workOrders).toBeNull()
      expect(hub.permissions.canViewWorkOrders).toBe(false)
      expect(hub.metrics.workshopHours).toBeNull()
      expect(hub.metrics.mttrHours).toBeNull()
      expect(hub.assets.every((asset) => asset.openWorkOrders === null && asset.inWorkshop === null)).toBe(true)
    })

    it("con la capacidad suma OT abiertas por equipo, el tile de atención, horas en taller y MTTR", async () => {
      mocks.rowsByQuery.set("mant_work_orders", [otRow])

      const hub = await getOperationalControlHub(session("flota:view", "mant:ot:view_all"))

      expect(hub.permissions.canViewWorkOrders).toBe(true)
      expect(hub.attention.workOrders).toEqual({ openCount: 3, unassignedOpen: 1, estimateOverdue: 1, waitingParts: 0 })
      const asset = (id: string) => hub.assets.find((a) => a.id === id)!
      expect(asset("en-mantencion")).toMatchObject({ openWorkOrders: 3, inWorkshop: true, workshopHours: 30 })
      // Un equipo sin OT tiene 0 (la consulta corrió), no null.
      expect(asset("operativo")).toMatchObject({ openWorkOrders: 0, inWorkshop: false, workshopHours: 0 })
      expect(hub.metrics.workshopHours).toBe(30)
      // MTTR = 40 h de las 2 reparaciones cerradas.
      expect(hub.metrics.mttrHours).toBe(20)
    })

    it("sin reparaciones cerradas el MTTR es null, no 0", async () => {
      mocks.rowsByQuery.set("mant_work_orders", [{ ...otRow, repairClosedInPeriod: 0, repairClosedWorkshopHours: 0 }])

      const hub = await getOperationalControlHub(session("flota:view", "mant:ot:view_worksite"))

      expect(hub.metrics.mttrHours).toBeNull()
      expect(hub.metrics.workshopHours).toBe(30)
    })

    it("la exportación (includeAttention: false) no pide las cifras globales del tile", async () => {
      mocks.rowsByQuery.set("mant_work_orders", [otRow])

      const hub = await getOperationalControlHub(session("flota:view", "mant:ot:view_all"), {}, { includeAttention: false })

      expect(hub.attention.workOrders).toBeNull()
      expect(mocks.issued.filter((table) => table === "mant_work_orders")).toHaveLength(1)
      expect(hub.assets.find((a) => a.id === "en-mantencion")?.openWorkOrders).toBe(3)
    })

    it("si la consulta de OT falla queda en null, se anuncia y el resto del panel sigue", async () => {
      mocks.failing.add("mant_work_orders")

      const hub = await getOperationalControlHub(session("flota:view", "mant:ot:view_all"))

      expect(hub.attention.workOrders).toBeNull()
      expect(hub.degradedSources).toEqual(expect.arrayContaining(["órdenes de trabajo"]))
      expect(hub.attention.stoppedVehicles?.total).toBe(3)
      expect(hub.assets).toHaveLength(5)
      expect(hub.assets.every((asset) => asset.openWorkOrders === null)).toBe(true)
      expect(hub.metrics.workshopHours).toBeNull()
    })
  })

  describe("compras vinculadas", () => {
    const purchaseRow = { vehicleId: "en-mantencion", purchaseAmount: 123_000, orderCount: 2, lastOrderAt: "2026-10-20T15:00:00.000Z" }

    it("sin purchasing:view no consulta compras y deja la cifra en null (entrar al panel no la habilita)", async () => {
      mocks.rowsByQuery.set("purchase_order_items", [purchaseRow])

      const hub = await getOperationalControlHub(session("flota:view"))

      expect(mocks.issued).not.toContain("purchase_order_items")
      expect(hub.permissions.canViewPurchaseCosts).toBe(false)
      expect(hub.assets.every((asset) => asset.purchaseAmount === null)).toBe(true)
    })

    it("con la capacidad suma las compras por equipo; un equipo sin compras tiene 0, no null", async () => {
      mocks.rowsByQuery.set("purchase_order_items", [purchaseRow])

      const hub = await getOperationalControlHub(session("flota:view", "purchasing:view"))

      expect(hub.permissions.canViewPurchaseCosts).toBe(true)
      expect(mocks.issued.filter((table) => table === "purchase_order_items")).toHaveLength(1)
      const asset = (id: string) => hub.assets.find((a) => a.id === id)!
      expect(asset("en-mantencion").purchaseAmount).toBe(123_000)
      expect(asset("operativo").purchaseAmount).toBe(0)
      // Falta combustible y mano de obra: con una sola serie no hay «total».
      expect(asset("en-mantencion").totalCost).toBeNull()
      expect(hub.degradedSources).toEqual([])
    })

    it("la exportación también las pide (el Excel lleva la columna)", async () => {
      mocks.rowsByQuery.set("purchase_order_items", [purchaseRow])

      const hub = await getOperationalControlHub(session("flota:view", "purchasing:view"), {}, { includeAttention: false })

      expect(hub.assets.find((a) => a.id === "en-mantencion")?.purchaseAmount).toBe(123_000)
    })

    it("si la consulta de compras falla queda en null (no 0), se anuncia y el resto del panel sigue", async () => {
      mocks.failing.add("purchase_order_items")

      const hub = await getOperationalControlHub(session("flota:view", "purchasing:view"))

      expect(hub.assets.every((asset) => asset.purchaseAmount === null && asset.totalCost === null)).toBe(true)
      expect(hub.degradedSources).toEqual(["compras"])
      expect(hub.attention.stoppedVehicles?.total).toBe(3)
      expect(hub.assets).toHaveLength(5)
      expect(mocks.logError).toHaveBeenCalledTimes(1)
    })
  })

  it("un permiso retirado con el módulo de mantenciones ya no abre el panel", async () => {
    await expect(getOperationalControlHub(session("mantenciones:view"))).rejects.toThrow("Sin permisos para Control operacional")
  })
})

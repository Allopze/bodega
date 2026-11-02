import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { FuelSourceStatus } from "@/lib/combustibles/sources-status"

/**
 * La tarjeta del Panel no reimplementa el estado de las fuentes: lo resume.
 * Estas pruebas fijan dos cosas que la pantalla de Fuentes ya garantiza y que
 * aquí no se pueden perder: una fuente caída se nombra, y un fallo de
 * conciliación no convierte el estado de las fuentes en «sin dato».
 */

const mocks = vi.hoisted(() => ({
  rowsByQuery: new Map<string, unknown[]>(),
  failing: new Set<string>(),
  issued: [] as string[],
  getFuelSourceStatuses: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm")
  return {
    db: {
      select: () => {
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
      },
    },
  }
})

vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) =>
    session?.user?.permissions?.includes(permission as never) ?? false,
}))

vi.mock("@/lib/auth/scope", () => ({
  worksiteScopeSql: () => undefined,
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/combustibles/sources-status", () => ({
  getFuelSourceStatuses: mocks.getFuelSourceStatuses,
  summarizeFuelSources: (statuses: FuelSourceStatus[]) => {
    const pending = statuses.filter((source) => source.status === "pendiente" || source.status === "falla")
    return { ready: statuses.length > 0 && pending.length === 0, pending }
  },
}))

import { getOperationalSourceHealth } from "@/lib/services/operational-control-sources"

const PERIOD = { from: "2026-10-01", to: "2026-10-31" }

function session(...permissions: string[]): Session {
  return { user: { id: "u1", permissions, isGlobal: true, worksiteIds: [] } } as unknown as Session
}

function source(overrides: Partial<FuelSourceStatus> = {}): FuelSourceStatus {
  return {
    key: "copec",
    name: "Copec",
    description: "",
    status: "ok",
    statusLabel: "Al día",
    lastUpdateAt: null,
    facts: [],
    feeds: [],
    problem: null,
    technical: [],
    ...overrides,
  }
}

beforeEach(() => {
  mocks.rowsByQuery.clear()
  mocks.failing.clear()
  mocks.issued.length = 0
  mocks.getFuelSourceStatuses.mockReset()
  mocks.logError.mockReset()
  mocks.rowsByQuery.set("fuel_reconciliation_links", [{ unmatched: 2, ambiguous: 1, acceptedExceptions: 3 }])
  mocks.rowsByQuery.set("fuel_provider_rejections", [{ open: 4 }])
  mocks.getFuelSourceStatuses.mockResolvedValue([
    source({ lastUpdateAt: "2026-10-30T10:00:00.000Z" }),
    source({
      key: "planilla",
      name: "Planilla de cargas",
      status: "pendiente",
      statusLabel: "Falta el mes",
      problem: "Falta importar octubre.",
      problemLink: { href: "/combustibles/fuentes", label: "Revisar" },
      lastUpdateAt: "2026-10-29T10:00:00.000Z",
    }),
  ])
})

describe("getOperationalSourceHealth", () => {
  it("resume las fuentes pendientes y la conciliación, con la última actualización más reciente", async () => {
    const health = await getOperationalSourceHealth(session("combustibles:view"), PERIOD)

    expect(health).toMatchObject({
      ready: false,
      total: 2,
      lastUpdateAt: "2026-10-30T10:00:00.000Z",
      reconciliation: { unmatched: 2, ambiguous: 1, acceptedExceptions: 3, openRejections: 4 },
    })
    expect(health?.pending).toEqual([
      expect.objectContaining({
        key: "planilla",
        name: "Planilla de cargas",
        statusLabel: "Falta el mes",
        problem: "Falta importar octubre.",
        problemLink: { href: "/combustibles/fuentes", label: "Revisar" },
      }),
    ])
  })

  it("sin permiso de combustible no consulta fuentes ni conciliación", async () => {
    const health = await getOperationalSourceHealth(session("flota:view"), PERIOD)

    expect(health).toBeNull()
    expect(mocks.getFuelSourceStatuses).not.toHaveBeenCalled()
    expect(mocks.issued).toEqual([])
  })

  it("un fallo de conciliación no tumba el estado de las fuentes", async () => {
    mocks.failing.add("fuel_reconciliation_links")

    const health = await getOperationalSourceHealth(session("combustibles:view"), PERIOD)

    expect(health?.reconciliation).toBeNull()
    expect(health?.pending).toHaveLength(1)
    expect(mocks.logError).toHaveBeenCalledTimes(1)
  })

  it("un fallo total devuelve una fuente pendiente explícita, no una tarjeta vacía", async () => {
    mocks.getFuelSourceStatuses.mockRejectedValueOnce(new Error("sin conexión"))

    const health = await getOperationalSourceHealth(session("combustibles:view"), PERIOD)

    expect(health).toMatchObject({
      ready: false,
      total: 0,
      lastUpdateAt: null,
      reconciliation: null,
    })
    expect(health?.pending).toEqual([
      expect.objectContaining({
        key: "fuentes",
        status: "pendiente",
        problem: "No se pudo consultar el estado de las fuentes.",
      }),
    ])
    expect(mocks.logError).toHaveBeenCalled()
  })

  it("con todas las fuentes al día queda listo y sin pendientes", async () => {
    mocks.getFuelSourceStatuses.mockResolvedValueOnce([source({ lastUpdateAt: "2026-10-30T10:00:00.000Z" })])

    const health = await getOperationalSourceHealth(session("combustibles:view"), PERIOD)

    expect(health).toMatchObject({ ready: true, total: 1, pending: [] })
  })
})

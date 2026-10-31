/**
 * Los avisos de Combustible hablan de «estado de cuenta» (rediseño de
 * Combustible, 2026-10-31): ni «resumen», ni «cartola», ni «cuenta corriente».
 * Llevan fechas legibles (no ISO), montos con el formato de la plataforma y
 * enlazan a las rutas nuevas de Pagos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockNotify = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())
const mockUnassignedCount = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    query: { fuelMonthlyStatements: { findMany: mockFindMany } },
    select: () => ({ from: () => ({ where: mockUnassignedCount }) }),
  },
}))
vi.mock("@/lib/services/notifications", () => ({ notifyManyUser: mockNotify }))
vi.mock("@/lib/services/notification-targeting", () => ({ getGlobalUserIdsWithAllPermissions: vi.fn(async () => ["user-1"]) }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { checkFuelStatementNotifications, previousMonth } from "../notifications"
import { fuelMonthLabel } from "../calculations"
import { chileDateParts } from "@/lib/utils"

const statement = (overrides: Record<string, unknown> = {}) => ({
  id: "st-1", month: "2026-09", totalAmount: 14_230_000, paidAmount: 5_830_000, dueDate: "2026-11-05",
  supplier: { name: "Aramco" }, ...overrides,
})

describe("avisos de estados de cuenta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnassignedCount.mockResolvedValue([{ count: 0 }])
  })

  it("el que vence pronto dice el proveedor y el mes en palabras, lo que falta y la fecha legible, y abre el detalle", async () => {
    mockFindMany.mockResolvedValueOnce([statement()]).mockResolvedValueOnce([])

    await checkFuelStatementNotifications()

    expect(mockNotify).toHaveBeenCalledTimes(1)
    const [, payload] = mockNotify.mock.calls[0]!
    expect(payload).toMatchObject({
      type: "fuel_statement_due_soon",
      title: "El estado de cuenta de Aramco de Septiembre 2026 vence pronto",
      entityHref: "/combustibles/pagos/estados/st-1",
    })
    expect(payload.body).toContain("Por pagar: $8.400.000")
    expect(payload.body).toContain("Vence el 05-11-2026")
    expect(payload.body).not.toContain("2026-11-05")
  })

  it("el vencido no usa mayúsculas gritadas ni emojis, y dice cuándo venció", async () => {
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([statement({ dueDate: "2026-10-05" })])

    await checkFuelStatementNotifications()

    const [, payload] = mockNotify.mock.calls[0]!
    expect(payload).toMatchObject({ type: "fuel_statement_overdue", title: "El estado de cuenta de Aramco de Septiembre 2026 está vencido" })
    expect(payload.title).not.toMatch(/VENCIDO|⚠/)
    expect(payload.body).toContain("Venció el 05-10-2026")
  })

  it("no avisa de un estado de cuenta ya pagado", async () => {
    mockFindMany.mockResolvedValueOnce([statement({ paidAmount: 14_230_000 })]).mockResolvedValueOnce([])

    await checkFuelStatementNotifications()

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it("las cargas del mes pasado sin estado de cuenta se avisan con el mes pasado ya elegido en la pantalla", async () => {
    mockFindMany.mockResolvedValue([])
    mockUnassignedCount.mockResolvedValue([{ count: 3 }])
    const { year, month } = chileDateParts()
    const previous = previousMonth(year, month)

    await checkFuelStatementNotifications()

    const [, payload] = mockNotify.mock.calls[0]!
    expect(payload).toMatchObject({
      type: "fuel_loads_unassigned",
      title: `3 cargas de ${fuelMonthLabel(previous)} sin estado de cuenta`,
      entityHref: `/combustibles/pagos/estados?periodo=${previous}`,
    })
    expect(`${payload.title} ${payload.body}`).not.toMatch(/resumen|cartola|cuenta corriente/i)
  })
})

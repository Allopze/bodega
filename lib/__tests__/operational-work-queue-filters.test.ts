import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import { parseOperationalQueueFilters } from "@/lib/services/operational-work-queue"

describe("parseOperationalQueueFilters", () => {
  it("conserva el filtro del módulo CPHS", () => {
    expect(parseOperationalQueueFilters({ module: "cphs" }).module).toBe("cphs")
  })

  it("conserva el filtro del módulo Mantención", () => {
    // Si no, `?module=mantencion` cae en «todos» y el gráfico por módulo del Inicio enlaza a un filtro que se ignora.
    expect(parseOperationalQueueFilters({ module: "mantencion" }).module).toBe("mantencion")
    expect(parseOperationalQueueFilters({ module: "inexistente" }).module).toBe("all")
  })

  it("degrada a la vista por defecto los ?quick= retirados (sin responsable / asignadas a mí)", () => {
    expect(parseOperationalQueueFilters({ quick: "unassigned" }).quick).toBe("all")
    expect(parseOperationalQueueFilters({ quick: "mine" }).quick).toBe("all")
    expect(parseOperationalQueueFilters({ quick: "overdue" }).quick).toBe("overdue")
  })
})

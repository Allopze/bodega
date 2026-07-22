import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: { select: mockSelect } }))

import { getMaterialEnvironmentalEvents } from "@/lib/services/prevention-indicadores"

/**
 * Crea una cadena de mock para db.select().from().where().orderBy()
 * que resuelve con el valor dado. Se usa para simular listVisibleWorksites.
 */
function mockWorksiteQuery(rows: Array<{ id: string; name: string }>) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValueOnce({
      where: vi.fn().mockReturnValueOnce({
        orderBy: vi.fn().mockResolvedValueOnce(rows),
      }),
    }),
  })
}

/**
 * Crea una cadena de mock para db.select().from().where()
 * que resuelve con el valor dado. Se usa para simular la consulta
 * principal de preventionIncidents.
 */
function mockIncidentQuery(rows: Array<Record<string, unknown>>) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValueOnce({
      where: vi.fn().mockResolvedValueOnce(rows),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getMaterialEnvironmentalEvents", () => {
  it("rejects an invalid year", async () => {
    await expect(getMaterialEnvironmentalEvents(2023, { mode: "all", ids: [] }))
      .rejects.toThrow("Año inválido")
    await expect(getMaterialEnvironmentalEvents(2101, { mode: "all", ids: [] }))
      .rejects.toThrow("Año inválido")
  })

  it("returns empty data when no worksites are visible (empty ids in scope)", async () => {
    // listVisibleWorksites returns early when scope has empty ids
    const result = await getMaterialEnvironmentalEvents(2026, { mode: "some", ids: [] })
    expect(result).toEqual({ worksites: [], eventData: [] })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it("aggregates events by type, month and worksite", async () => {
    mockWorksiteQuery([{ id: "ws-a", name: "Faena A" }])
    mockIncidentQuery([
      { incidentId: "i1", worksiteId: "ws-a", year: 2026, month: 3, eventType: "dangerous_incident" },
      { incidentId: "i2", worksiteId: "ws-a", year: 2026, month: 3, eventType: "material_damage" },
      { incidentId: "i3", worksiteId: "ws-a", year: 2026, month: 3, eventType: "environmental_spill" },
      { incidentId: "i4", worksiteId: "ws-a", year: 2026, month: 5, eventType: "material_damage" },
      { incidentId: "i5", worksiteId: "ws-a", year: 2026, month: 5, eventType: "dangerous_incident" },
    ])

    const result = await getMaterialEnvironmentalEvents(2026, { mode: "all", ids: [] })

    expect(result.worksites).toEqual([{ id: "ws-a", name: "Faena A" }])
    expect(result.eventData).toHaveLength(2) // ws-a + total

    const wsGroup = result.eventData.find((item) => item.worksiteId === "ws-a")!
    expect(wsGroup.worksiteName).toBe("Faena A")

    // March (month 3)
    expect(wsGroup.monthly[2]).toEqual({ month: 3, dangerousIncidents: 1, materialDamage: 1, environmentalSpills: 1 })
    // May (month 5)
    expect(wsGroup.monthly[4]).toEqual({ month: 5, dangerousIncidents: 1, materialDamage: 1, environmentalSpills: 0 })
    // Empty months
    expect(wsGroup.monthly[0]).toEqual({ month: 1, dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0 })
    expect(wsGroup.monthly[11]).toEqual({ month: 12, dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0 })

    expect(wsGroup.annual).toEqual({ dangerousIncidents: 2, materialDamage: 2, environmentalSpills: 1 })
  })

  it("ignores non-relevant event types", async () => {
    mockWorksiteQuery([{ id: "ws-a", name: "Faena A" }])
    mockIncidentQuery([
      { incidentId: "i1", worksiteId: "ws-a", year: 2026, month: 6, eventType: "dangerous_incident" },
      // These should NOT be counted:
      { incidentId: "i2", worksiteId: "ws-a", year: 2026, month: 6, eventType: "work_accident" },
      { incidentId: "i3", worksiteId: "ws-a", year: 2026, month: 6, eventType: "commute_accident" },
      { incidentId: "i4", worksiteId: "ws-a", year: 2026, month: 6, eventType: "vehicle_event" },
    ])

    const result = await getMaterialEnvironmentalEvents(2026, { mode: "all", ids: [] })

    const wsGroup = result.eventData.find((item) => item.worksiteId === "ws-a")!
    expect(wsGroup.monthly[5]).toEqual({ month: 6, dangerousIncidents: 1, materialDamage: 0, environmentalSpills: 0 })
    expect(wsGroup.annual).toEqual({ dangerousIncidents: 1, materialDamage: 0, environmentalSpills: 0 })
  })

  it("aggregates across multiple worksites and builds a total row", async () => {
    mockWorksiteQuery([
      { id: "ws-a", name: "Faena A" },
      { id: "ws-b", name: "Faena B" },
    ])
    mockIncidentQuery([
      { incidentId: "i1", worksiteId: "ws-a", year: 2026, month: 1, eventType: "material_damage" },
      { incidentId: "i2", worksiteId: "ws-a", year: 2026, month: 1, eventType: "dangerous_incident" },
      { incidentId: "i3", worksiteId: "ws-b", year: 2026, month: 1, eventType: "dangerous_incident" },
      { incidentId: "i4", worksiteId: "ws-b", year: 2026, month: 1, eventType: "environmental_spill" },
    ])

    const result = await getMaterialEnvironmentalEvents(2026, { mode: "all", ids: [] })

    expect(result.eventData).toHaveLength(3) // ws-a + ws-b + total

    const wsA = result.eventData.find((item) => item.worksiteId === "ws-a")!
    expect(wsA.annual).toEqual({ dangerousIncidents: 1, materialDamage: 1, environmentalSpills: 0 })

    const wsB = result.eventData.find((item) => item.worksiteId === "ws-b")!
    expect(wsB.annual).toEqual({ dangerousIncidents: 1, materialDamage: 0, environmentalSpills: 1 })

    const total = result.eventData.find((item) => item.worksiteId === "total")!
    expect(total.worksiteName).toBe("Total de faenas visibles")
    expect(total.annual).toEqual({ dangerousIncidents: 2, materialDamage: 1, environmentalSpills: 1 })
    expect(total.monthly[0]).toEqual({ month: 1, dangerousIncidents: 2, materialDamage: 1, environmentalSpills: 1 })
  })

  it("respects scope filtering", async () => {
    mockWorksiteQuery([{ id: "ws-b", name: "Faena B" }])
    mockIncidentQuery([
      { incidentId: "i3", worksiteId: "ws-b", year: 2026, month: 1, eventType: "dangerous_incident" },
    ])

    const result = await getMaterialEnvironmentalEvents(2026, { mode: "some", ids: ["ws-b"] })

    expect(result.worksites).toHaveLength(1)
    expect(result.worksites[0]!.id).toBe("ws-b")
    expect(result.eventData).toHaveLength(2) // ws-b + total
    expect(result.eventData.find((item) => item.worksiteId === "ws-a")).toBeUndefined()
  })

  it("handles no events gracefully with all zeros", async () => {
    mockWorksiteQuery([{ id: "ws-a", name: "Faena A" }])
    mockIncidentQuery([])

    const result = await getMaterialEnvironmentalEvents(2026, { mode: "all", ids: [] })

    const wsGroup = result.eventData.find((item) => item.worksiteId === "ws-a")!
    expect(wsGroup.monthly.every((item) =>
      item.dangerousIncidents === 0 && item.materialDamage === 0 && item.environmentalSpills === 0,
    )).toBe(true)
    expect(wsGroup.annual).toEqual({ dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0 })
  })
})

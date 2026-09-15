import { describe, expect, it } from "vitest"
import source from "@/db/seed/pdtp-catalog-2026.json"
import { PDTP_2026_CATALOG_ACTIVITIES, PDTP_2026_LOCAL_CONTENT_OVERRIDES } from "./catalog-activities-2026"

describe("manifestación corporativa de actividades PDTP 2026", () => {
  it("preserva las 87 filas 1:1 y sus textos históricos", () => {
    expect(PDTP_2026_CATALOG_ACTIVITIES).toHaveLength(87)

    for (const row of source.activities) {
      const catalogActivity = PDTP_2026_CATALOG_ACTIVITIES.find((candidate) => candidate.legacyNumber === row.n)
      expect(catalogActivity).toMatchObject({
        description: PDTP_2026_LOCAL_CONTENT_OVERRIDES[row.n]?.description ?? row.activity,
        executionGuidance: PDTP_2026_LOCAL_CONTENT_OVERRIDES[row.n]?.executionGuidance ?? row.program,
        revision: 1,
      })
    }
  })

  it("declara identidades, códigos y títulos aptos para selección", () => {
    const ids = PDTP_2026_CATALOG_ACTIVITIES.map((activity) => activity.id)
    const codes = PDTP_2026_CATALOG_ACTIVITIES.map((activity) => activity.code)
    const titles = PDTP_2026_CATALOG_ACTIVITIES.map((activity) => activity.title)

    expect(new Set(ids).size).toBe(87)
    expect(new Set(codes).size).toBe(87)
    expect(new Set(titles).size).toBe(87)
    expect(Math.max(...titles.map((title) => title.length))).toBeLessThanOrEqual(80)
  })

  it("mantiene retiradas las seis identidades históricas locales", () => {
    expect(PDTP_2026_CATALOG_ACTIVITIES.filter((activity) => activity.status === "retired").map((activity) => activity.legacyNumber))
      .toEqual([2, 5, 12, 13, 14, 21])
    expect(PDTP_2026_CATALOG_ACTIVITIES.filter((activity) => activity.status === "active")).toHaveLength(81)
  })

  it("distingue explícitamente los pares cuyo texto histórico se repite", () => {
    for (const pair of [[30, 31], [33, 34], [37, 38], [64, 65], [68, 70]] as const) {
      const left = PDTP_2026_CATALOG_ACTIVITIES.find((activity) => activity.legacyNumber === pair[0])
      const right = PDTP_2026_CATALOG_ACTIVITIES.find((activity) => activity.legacyNumber === pair[1])
      expect(left).toBeDefined()
      expect(right).toBeDefined()
      if (!left || !right) throw new Error(`Falta el par histórico ${pair.join("/")}`)
      expect(left.title).not.toBe(right.title)
      expect(left.description).toBe(right.description)
    }
  })
})

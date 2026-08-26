import { describe, expect, it } from "vitest"
import { firstControlDescription, generateCapaActionsFromRiskEntries } from "@/lib/services/prevention-risk-capa"

const fullAccess = { userId: "u1", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:capa:manage", "prevention:risk:edit"] }

describe("firstControlDescription", () => {
  it("elige por jerarquía elimination > substitution > engineering > administrative > ppe, no por orden de llegada", () => {
    const controls = [
      { hierarchy: "ppe", description: "Usar EPP" },
      { hierarchy: "administrative", description: "Procedimiento de trabajo seguro" },
      { hierarchy: "engineering", description: "Instalar barrera física" },
    ]
    expect(firstControlDescription(controls)).toBe("Instalar barrera física")
  })

  it("devuelve null sin controles", () => {
    expect(firstControlDescription([])).toBeNull()
  })
})

describe("generateCapaActionsFromRiskEntries — validación de acceso e input", () => {
  it("rechaza sin prevention:capa:manage", async () => {
    const access = { ...fullAccess, permissions: ["prevention:risk:edit"] }
    await expect(generateCapaActionsFromRiskEntries({ riskEntryIds: ["re-1"], defaults: { targetDate: "2026-09-01" } }, access))
      .rejects.toThrow(/sin permiso para gestionar el programa de trabajo/i)
  })

  it("rechaza sin prevention:risk:edit", async () => {
    const access = { ...fullAccess, permissions: ["prevention:capa:manage"] }
    await expect(generateCapaActionsFromRiskEntries({ riskEntryIds: ["re-1"], defaults: { targetDate: "2026-09-01" } }, access))
      .rejects.toThrow(/sin permiso para generar acciones desde miper/i)
  })

  it("rechaza una lista de riesgos vacía", async () => {
    await expect(generateCapaActionsFromRiskEntries({ riskEntryIds: [], defaults: { targetDate: "2026-09-01" } }, fullAccess)).rejects.toThrow()
  })

  it("rechaza agrupar en una sola acción sin descripción", async () => {
    await expect(generateCapaActionsFromRiskEntries({
      riskEntryIds: ["re-1", "re-2"],
      defaults: { targetDate: "2026-09-01", groupIntoSingleAction: true },
    }, fullAccess)).rejects.toThrow(/exige una descripción/i)
  })

  it("rechaza una fecha objetivo con formato inválido", async () => {
    await expect(generateCapaActionsFromRiskEntries({ riskEntryIds: ["re-1"], defaults: { targetDate: "01-09-2026" } }, fullAccess)).rejects.toThrow()
  })
})

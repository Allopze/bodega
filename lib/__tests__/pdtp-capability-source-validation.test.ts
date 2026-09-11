import { describe, expect, it } from "vitest"
import {
  pdtpActivityAddSchema,
  pdtpActivityUpdateSchema,
} from "@/lib/validation/prevention-module/pdtp"

const addBase = {
  programId: "program-1",
  activity: "Manejo a la defensiva",
  program: "Prevención",
  responsibleSlugs: ["prevencionista"],
  responsibleDisplay: "Prevencionista",
  scheduleMode: "scheduled" as const,
  recurrenceRule: {
    frequency: "annual" as const,
    interval: 1,
    plannedQuantity: 1,
    weekOfMonth: 1,
  },
  indicatorMode: "coverage" as const,
  sheetCodes: ["programa"],
}

describe("Configuración de padrón PDTP por capacidades", () => {
  it("acepta una fuente con varias capacidades normalizadas y sin duplicados", () => {
    const parsed = pdtpActivityAddSchema.parse({
      ...addBase,
      subjectSource: "trabajadores_capacidad",
      subjectCapabilityCodes: ["drives_vehicle", "operates_equipment", "drives_vehicle"],
    })

    expect(parsed.subjectSource).toBe("trabajadores_capacidad")
    expect(parsed.subjectCapabilityCodes).toEqual(["drives_vehicle", "operates_equipment"])
  })

  it("rechaza la fuente de trabajadores si no declara capacidades", () => {
    const result = pdtpActivityAddSchema.safeParse({
      ...addBase,
      subjectSource: "trabajadores_capacidad",
      subjectCapabilityCodes: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.subjectCapabilityCodes).toContain(
        "Selecciona al menos una capacidad para construir el padrón",
      )
    }
  })

  it("rechaza capacidades para fuentes que no son trabajadores por capacidad", () => {
    const result = pdtpActivityUpdateSchema.safeParse({
      activityId: "activity-1",
      subjectSource: "dotacion",
      subjectCapabilityCodes: ["drives_vehicle"],
    })

    expect(result.success).toBe(false)
  })

  it("conserva las fuentes históricas sin exigir configuración adicional", () => {
    expect(pdtpActivityUpdateSchema.parse({
      activityId: "activity-1",
      subjectSource: "extintores",
    })).toMatchObject({ subjectSource: "extintores" })
  })
})

import { describe, expect, it } from "vitest"
import {
  equipmentFamilyInputSchema,
  findAliasConflicts,
  mandanteInputSchema,
  normalizeAliases,
  parseDecimalInput,
  performanceThresholdsSchema,
  providerMappingFromColumns,
  providerMappingToColumns,
  recomputeProgressLabel,
  slugify,
  supplyMediumInputSchema,
  uniqueSlug,
} from "./catalogs"

describe("parseDecimalInput", () => {
  it("acepta coma decimal, punto decimal y miles con punto", () => {
    expect(parseDecimalInput("2,5")).toBe(2.5)
    expect(parseDecimalInput(" 2.5 ")).toBe(2.5)
    expect(parseDecimalInput("1.234,5")).toBe(1234.5)
    expect(parseDecimalInput(3)).toBe(3)
  })
  it("rechaza texto, vacío e infinitos", () => {
    expect(parseDecimalInput("")).toBeNull()
    expect(parseDecimalInput("abc")).toBeNull()
    expect(parseDecimalInput("1,2,3")).toBeNull()
    expect(parseDecimalInput(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseDecimalInput(null)).toBeNull()
  })
})

describe("slugify / uniqueSlug", () => {
  it("quita tildes y signos", () => {
    expect(slugify("Surtidor CMPC · Planta Ñuble")).toBe("surtidor-cmpc-planta-nuble")
    expect(slugify("!!!")).toBe("medio")
  })
  it("agrega sufijo cuando el slug ya existe", () => {
    expect(uniqueSlug("tct", ["tct", "tct-2"])).toBe("tct-3")
    expect(uniqueSlug("nuevo", ["tct"])).toBe("nuevo")
  })
})

describe("normalizeAliases", () => {
  it("guarda en mayúsculas, sin vacíos ni repetidos", () => {
    expect(normalizeAliases(" cmpc , Surtidor  CMPC,, cmpc ;copec")).toEqual(["CMPC", "SURTIDOR CMPC", "COPEC"])
  })
  it("acepta una lista ya separada", () => {
    expect(normalizeAliases(["tae", "TAE "])).toEqual(["TAE"])
  })
})

describe("mapeo de proveedor", () => {
  it("ida y vuelta de cada opción", () => {
    for (const mapping of ["none", "copec_tct", "copec_tae", "aramco"] as const) {
      const { providerCode, providerChannel } = providerMappingToColumns(mapping)
      expect(providerMappingFromColumns(providerCode, providerChannel)).toBe(mapping)
    }
  })
  it("Aramco no lleva canal", () => {
    expect(providerMappingToColumns("aramco")).toEqual({ providerCode: "aramco", providerChannel: null })
  })
  it("un canal desconocido de Copec queda sin mapeo", () => {
    expect(providerMappingFromColumns("copec", null)).toBe("none")
  })
})

describe("mandanteInputSchema", () => {
  const base = { name: "  Arauco  ", clientId: null, tolerancePct: "2,5", isActive: true, worksiteIds: ["w1", "w1", "w2"] }
  it("acepta coma decimal, recorta y deduplica faenas", () => {
    const parsed = mandanteInputSchema.parse(base)
    expect(parsed.name).toBe("Arauco")
    expect(parsed.tolerancePct).toBe(2.5)
    expect(parsed.worksiteIds).toEqual(["w1", "w2"])
    expect(parsed.confirmMove).toBe(false)
  })
  it("rechaza tolerancia fuera de 0–100 o no numérica", () => {
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "101" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "-1" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "dos" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "100" }).success).toBe(true)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "0" }).success).toBe(true)
  })
  it("rechaza nombre corto", () => {
    expect(mandanteInputSchema.safeParse({ ...base, name: " a " }).success).toBe(false)
  })
})

describe("supplyMediumInputSchema", () => {
  const base = { name: "Surtidor CMPC", kind: "mandante_dispenser", fuelSupplierId: null, providerMapping: "none", aliases: "cmpc, surtidor cmpc", sortOrder: "5", isActive: true }
  it("normaliza alias y deriva proveedor y canal", () => {
    const parsed = supplyMediumInputSchema.parse({ ...base, providerMapping: "copec_tae" })
    expect(parsed.aliases).toEqual(["CMPC", "SURTIDOR CMPC"])
    expect(parsed.providerCode).toBe("copec")
    expect(parsed.providerChannel).toBe("TAE")
    expect(parsed.sortOrder).toBe(5)
  })
  it("rechaza tipo inválido, orden fraccionario y demasiados alias", () => {
    expect(supplyMediumInputSchema.safeParse({ ...base, kind: "otro" }).success).toBe(false)
    expect(supplyMediumInputSchema.safeParse({ ...base, sortOrder: "1,5" }).success).toBe(false)
    const many = Array.from({ length: 31 }, (_, index) => `alias${index}`).join(",")
    const result = supplyMediumInputSchema.safeParse({ ...base, aliases: many })
    expect(result.success).toBe(false)
  })
  it("orden vacío = 0", () => {
    expect(supplyMediumInputSchema.parse({ ...base, sortOrder: "" }).sortOrder).toBe(0)
  })
})

describe("findAliasConflicts", () => {
  it("detecta alias de otro medio y ignora el propio", () => {
    const others = [{ id: "a", name: "TCT", aliases: ["TCT", "TARJETA"] }, { id: "b", name: "CMPC", aliases: ["CMPC"] }]
    expect(findAliasConflicts(["TARJETA", "NUEVO"], others, "b")).toEqual([{ alias: "TARJETA", mediumName: "TCT" }])
    expect(findAliasConflicts(["CMPC"], others, "b")).toEqual([])
  })
})

describe("equipmentFamilyInputSchema", () => {
  it("acepta una familia o null (fuera de las vistas)", () => {
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: "camiones" }).success).toBe(true)
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: null }).success).toBe(true)
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: "heavy" }).success).toBe(false)
  })
})

describe("performanceThresholdsSchema", () => {
  const ok = { minSamples: "5", maxKmPerLiter: "25", maxLitersPerHour: "80,5", duplicateWindowMinutes: "15", duplicateLitersTolerance: "0,5" }
  it("lee números con coma", () => {
    expect(performanceThresholdsSchema.parse(ok)).toEqual({ minSamples: 5, maxKmPerLiter: 25, maxLitersPerHour: 80.5, duplicateWindowMinutes: 15, duplicateLitersTolerance: 0.5 })
  })
  it("rechaza enteros fraccionarios y cotas imposibles", () => {
    expect(performanceThresholdsSchema.safeParse({ ...ok, minSamples: "1" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, minSamples: "5,5" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, maxKmPerLiter: "0" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, duplicateLitersTolerance: "-1" }).success).toBe(false)
  })
})

describe("recomputeProgressLabel", () => {
  it("singular y plural", () => {
    expect(recomputeProgressLabel(1, 1)).toBe("1 de 1 equipo")
    expect(recomputeProgressLabel(50, 130)).toBe("50 de 130 equipos")
  })
})

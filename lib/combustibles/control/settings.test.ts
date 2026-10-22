import { describe, expect, it } from "vitest"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS } from "./contracts"
import { mergeStoredSettings, performanceControlSettingsSchema, thresholdForEquipmentType } from "./settings"
import { normalizeLoadTime, normalizeMediumText, resolveSupplyMedium } from "./projection-sources"

describe("ajustes del control de rendimiento", () => {
  it("sin nada guardado usa los valores por defecto", () => {
    expect(mergeStoredSettings(null)).toEqual(DEFAULT_PERFORMANCE_CONTROL_SETTINGS)
    expect(mergeStoredSettings("no es json")).toEqual(DEFAULT_PERFORMANCE_CONTROL_SETTINGS)
  })

  it("un campo inválido vuelve a su default sin arrastrar a los demás", () => {
    const merged = mergeStoredSettings(JSON.stringify({ minSamples: 8, maxKmPerLiter: -3 }))
    expect(merged.minSamples).toBe(8)
    expect(merged.maxKmPerLiter).toBe(DEFAULT_PERFORMANCE_CONTROL_SETTINGS.maxKmPerLiter)
  })

  it("el esquema rechaza valores fuera de rango con mensaje en español", () => {
    const result = performanceControlSettingsSchema.safeParse({ ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS, minSamples: 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe("Se necesitan al menos 2 muestras")
    expect(performanceControlSettingsSchema.safeParse(DEFAULT_PERFORMANCE_CONTROL_SETTINGS).success).toBe(true)
  })

  it("k por tipo de equipo: excepción de la regla o el general", () => {
    const config = JSON.stringify({ thresholdStdDevs: 2.5, equipmentTypes: { excavadora: { thresholdStdDevs: 3 } } })
    const settings = { ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS, thresholdStdDevs: 2.5 }
    expect(thresholdForEquipmentType(settings, config, "excavadora")).toBe(3)
    expect(thresholdForEquipmentType(settings, config, "camion")).toBe(2.5)
    expect(thresholdForEquipmentType(settings, null, null)).toBe(2.5)
  })
})

describe("lectura del log operacional", () => {
  it("normaliza la hora de carga", () => {
    expect(normalizeLoadTime("8:05")).toBe("08:05")
    expect(normalizeLoadTime("14:30:59")).toBe("14:30")
    expect(normalizeLoadTime("25:00")).toBe("00:00")
    expect(normalizeLoadTime(null)).toBe("00:00")
  })

  it("resuelve el medio por alias o nombre y, si no, por proveedor", () => {
    const index = {
      byText: new Map([[normalizeMediumText("Copec TCT"), "fsm-tct"]]),
      bySupplier: new Map([["sup-aramco", "fsm-aramco"]]),
    }
    expect(resolveSupplyMedium(index, "  copec   tct ", null)).toBe("fsm-tct")
    expect(resolveSupplyMedium(index, "OTRO", "sup-aramco")).toBe("fsm-aramco")
    expect(resolveSupplyMedium(index, null, null)).toBeNull()
  })
})

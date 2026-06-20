/**
 * Unit tests for SST compliance logic (pure functions, no DB).
 */

import { describe, it, expect } from "vitest"

import {
  calculateCompliance,
  classifyEfficacy,
  getAutomaticResultadoFinal,
  getEfficacyLabel,
  getEfficacyColor,
  getStatusLabel,
  isPositiveStatus,
  isNegativeStatus,
} from "@/lib/sst/compliance"
import type { StatusValue } from "@/lib/sst/types"

describe("calculateCompliance", () => {
  it("returns 100% when all positive", () => {
    const result = calculateCompliance([
      { estado: "cumple" },
      { estado: "entregado" },
      { estado: "apto" },
      { estado: "si" },
    ])
    expect(result.percentage).toBe(100)
    expect(result.cumplidos).toBe(4)
    expect(result.noCumplidos).toBe(0)
    expect(result.na).toBe(0)
  })

  it("returns 0% when all negative", () => {
    const result = calculateCompliance([
      { estado: "no_cumple" },
      { estado: "no_entregado" },
      { estado: "no_apto" },
    ])
    expect(result.percentage).toBe(0)
    expect(result.cumplidos).toBe(0)
    expect(result.noCumplidos).toBe(3)
  })

  it("excludes N/A from calculation", () => {
    const result = calculateCompliance([
      { estado: "cumple" },
      { estado: "na" },
    ])
    expect(result.percentage).toBe(100)
    expect(result.na).toBe(1)
    expect(result.total).toBe(1)
  })

  it("handles mixed statuses", () => {
    const result = calculateCompliance([
      { estado: "cumple" },
      { estado: "cumple" },
      { estado: "no_cumple" },
      { estado: "na" },
    ])
    expect(result.percentage).toBeCloseTo(66.67)
    expect(result.cumplidos).toBe(2)
    expect(result.noCumplidos).toBe(1)
    expect(result.na).toBe(1)
  })

  it("returns 0% for empty array", () => {
    const result = calculateCompliance([])
    expect(result.percentage).toBe(0)
  })

  it("handles null statuses (excluded from denominator)", () => {
    const result = calculateCompliance([
      { estado: null as unknown as StatusValue },
      { estado: "cumple" },
    ])
    expect(result.percentage).toBe(100)
    expect(result.total).toBe(1)
  })
})

describe("classifyEfficacy", () => {
  it("classifies as eficaz at 90%+ with no critical conditions", () => {
    const result = classifyEfficacy(95)
    expect(result.classification).toBe("eficaz")
  })

  it("classifies as parcialmente_eficaz at 70-89%", () => {
    expect(classifyEfficacy(80).classification).toBe("parcialmente_eficaz")
    expect(classifyEfficacy(70).classification).toBe("parcialmente_eficaz")
  })

  it("classifies as no_eficaz below 70%", () => {
    expect(classifyEfficacy(50).classification).toBe("no_eficaz")
    expect(classifyEfficacy(69).classification).toBe("no_eficaz")
  })

  it("classifies as no_eficaz with critical deviation", () => {
    expect(classifyEfficacy(95, true).classification).toBe("no_eficaz")
  })

  it("classifies as no_eficaz with reincidence", () => {
    expect(classifyEfficacy(95, false, true).classification).toBe("no_eficaz")
  })

  it("classifies as no_eficaz with blocker", () => {
    expect(classifyEfficacy(95, false, false, true).classification).toBe("no_eficaz")
  })
})

describe("getAutomaticResultadoFinal", () => {
  const allCumple = (sections: string[]) =>
    sections.map((s) => ({ seccionId: s, itemId: "item-1", estado: "cumple" as StatusValue }))

  const hasNoCumple = (sections: string[]) =>
    sections.map((s) => ({ seccionId: s, itemId: "item-1", estado: "no_cumple" as StatusValue }))

  describe("trabajador_nuevo", () => {
    it("returns habilitado_autonomo at >=90%", () => {
      expect(getAutomaticResultadoFinal("trabajador_nuevo", 95, allCumple(["doc"]))).toBe("habilitado_autonomo")
    })

    it("returns no_habilitado at <90%", () => {
      expect(getAutomaticResultadoFinal("trabajador_nuevo", 80, allCumple(["doc"]))).toBe("no_habilitado")
    })

    it("returns no_habilitado with blocker section failure", () => {
      expect(getAutomaticResultadoFinal("trabajador_nuevo", 95, hasNoCumple(["documentacion_requisitos"]))).toBe("no_habilitado")
    })

    it("ignores protocolos_minsal as blocker", () => {
      const resp = [{ seccionId: "documentacion_requisitos", itemId: "protocolos_minsal", estado: "no_cumple" as StatusValue }]
      expect(getAutomaticResultadoFinal("trabajador_nuevo", 95, resp)).toBe("habilitado_autonomo")
    })
  })

  describe("trabajador_antiguo", () => {
    it("returns habilitado_autonomo at >=90%", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 95, allCumple(["procedimientos_criticos"]))).toBe("habilitado_autonomo")
    })

    it("returns habilitado_restricciones at 70-89%", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 80, allCumple(["procedimientos_criticos"]))).toBe("habilitado_restricciones")
    })

    it("returns no_habilitado at <70%", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 50, allCumple(["procedimientos_criticos"]))).toBe("no_habilitado")
    })

    it("returns no_habilitado with critical deviation", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 95, allCumple(["procedimientos_criticos"]), true)).toBe("no_habilitado")
    })

    it("returns no_habilitado with reincidence", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 95, allCumple(["procedimientos_criticos"]), false, true)).toBe("no_habilitado")
    })

    it("returns no_habilitado with blocker section failure", () => {
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 95, hasNoCumple(["control_ampliroll"]))).toBe("no_habilitado")
    })

    it("ignores protocolos_minsal as blocker for ancient worker", () => {
      const resp = [{ seccionId: "procedimientos_criticos", itemId: "protocolos_minsal", estado: "no_cumple" as StatusValue }]
      expect(getAutomaticResultadoFinal("trabajador_antiguo", 95, resp)).toBe("habilitado_autonomo")
    })
  })
})

describe("getEfficacyLabel", () => {
  it("returns correct labels", () => {
    expect(getEfficacyLabel("eficaz")).toBe("Eficaz")
    expect(getEfficacyLabel("parcialmente_eficaz")).toBe("Parcialmente eficaz")
    expect(getEfficacyLabel("no_eficaz")).toBe("No eficaz")
  })

  it("returns empty for null/undefined", () => {
    expect(getEfficacyLabel(null as never)).toBe("")
  })
})

describe("getEfficacyColor", () => {
  it("returns correct colors", () => {
    expect(getEfficacyColor("eficaz")).toContain("emerald")
    expect(getEfficacyColor("parcialmente_eficaz")).toContain("amber")
    expect(getEfficacyColor("no_eficaz")).toContain("rose")
    expect(getEfficacyColor(null as never)).toContain("slate")
  })
})

describe("getStatusLabel", () => {
  it("returns correct labels", () => {
    expect(getStatusLabel("cumple")).toBe("Cumple")
    expect(getStatusLabel("no_cumple")).toBe("No cumple")
    expect(getStatusLabel("na")).toBe("N/A")
    expect(getStatusLabel("entregado")).toBe("Entregado")
    expect(getStatusLabel(null as never)).toBe("—")
  })
})

describe("isPositiveStatus", () => {
  it("identifies positive statuses", () => {
    expect(isPositiveStatus("cumple")).toBe(true)
    expect(isPositiveStatus("entregado")).toBe(true)
    expect(isPositiveStatus("apto")).toBe(true)
    expect(isPositiveStatus("si")).toBe(true)
    expect(isPositiveStatus("no_cumple")).toBe(false)
    expect(isPositiveStatus("na")).toBe(false)
  })
})

describe("isNegativeStatus", () => {
  it("identifies negative statuses", () => {
    expect(isNegativeStatus("no_cumple")).toBe(true)
    expect(isNegativeStatus("no_entregado")).toBe(true)
    expect(isNegativeStatus("no_apto")).toBe(true)
    expect(isNegativeStatus("no")).toBe(true)
    expect(isNegativeStatus("cumple")).toBe(false)
    expect(isNegativeStatus("na")).toBe(false)
  })
})

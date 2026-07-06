import { describe, expect, it } from "vitest"
import { calculateCompliance, classifyEfficacy, getAutomaticResultadoFinal } from "./compliance"
import type { StatusValue } from "./types"

describe("calculateCompliance", () => {
  it("returns 100% when all items are positive", () => {
    const result = calculateCompliance([
      { estado: "cumple" },
      { estado: "entregado" },
      { estado: "apto" },
      { estado: "si" },
    ])
    expect(result.percentage).toBe(100)
    expect(result.cumplidos).toBe(4)
    expect(result.noCumplidos).toBe(0)
  })

  it("returns 0% when all items are negative", () => {
    const result = calculateCompliance([
      { estado: "no_cumple" },
      { estado: "no" },
    ])
    expect(result.percentage).toBe(0)
    expect(result.cumplidos).toBe(0)
    expect(result.noCumplidos).toBe(2)
  })

  it("excludes N/A items from calculation", () => {
    const result = calculateCompliance([
      { estado: "cumple" },
      { estado: "no_cumple" },
      { estado: "na" },
      { estado: "na" },
    ])
    expect(result.percentage).toBe(50)
    expect(result.cumplidos).toBe(1)
    expect(result.noCumplidos).toBe(1)
    expect(result.na).toBe(2)
    expect(result.total).toBe(2)
  })

  it("returns 0% when no applicable items (all N/A or null)", () => {
    const result = calculateCompliance([
      { estado: "na" },
      { estado: null as unknown as StatusValue },
    ])
    expect(result.percentage).toBe(0)
    expect(result.total).toBe(0)
  })

  it("handles empty array", () => {
    const result = calculateCompliance([])
    expect(result.percentage).toBe(0)
    expect(result.total).toBe(0)
  })
})

describe("classifyEfficacy", () => {
  it("clasifica como eficaz con >=90% sin desviaciones críticas ni reincidencia", () => {
    const result = classifyEfficacy(95)
    expect(result.classification).toBe("eficaz")
  })

  it("clasifica como parcialmente eficaz con 70-89%", () => {
    const result = classifyEfficacy(75)
    expect(result.classification).toBe("parcialmente_eficaz")
  })

  it("clasifica como no eficaz con <70%", () => {
    const result = classifyEfficacy(65)
    expect(result.classification).toBe("no_eficaz")
  })

  it("clasifica como no eficaz si hay desviación crítica aunque el % sea alto", () => {
    const result = classifyEfficacy(95, true)
    expect(result.classification).toBe("no_eficaz")
  })

  it("clasifica como no eficaz si hay reincidencia", () => {
    const result = classifyEfficacy(95, false, true)
    expect(result.classification).toBe("no_eficaz")
  })

  it("clasifica como no eficaz si hay blocker", () => {
    const result = classifyEfficacy(95, false, false, true)
    expect(result.classification).toBe("no_eficaz")
  })
})

describe("getAutomaticResultadoFinal", () => {
  describe("trabajador_nuevo", () => {
    it("retorna habilitado_autonomo con >=90% sin bloqueos", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        95,
        [],
      )
      expect(result).toBe("habilitado_autonomo")
    })

    it("retorna no_habilitado con <90%", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        85,
        [],
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado si hay bloqueo en documentacion_requisitos", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        95,
        [{ seccionId: "documentacion_requisitos", itemId: "contrato_trabajo", estado: "no_cumple" as StatusValue }],
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado si hay bloqueo en induccion_capacitacion", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        95,
        [{ seccionId: "induccion_capacitacion", itemId: "induccion_irl", estado: "no_entregado" as StatusValue }],
      )
      expect(result).toBe("no_habilitado")
    })

    it("protocolos_minsal NO es bloqueante (explicitly excluded)", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        95,
        [{ seccionId: "documentacion_requisitos", itemId: "protocolos_minsal", estado: "no_entregado" as StatusValue }],
      )
      expect(result).toBe("habilitado_autonomo")
    })

    it("otro item con resultado negativo en documentacion_requisitos SÍ bloquea", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_nuevo",
        95,
        [
          { seccionId: "documentacion_requisitos", itemId: "protocolos_minsal", estado: "no_entregado" as StatusValue },
          { seccionId: "documentacion_requisitos", itemId: "contrato_trabajo", estado: "no_cumple" as StatusValue },
        ],
      )
      expect(result).toBe("no_habilitado")
    })
  })

  describe("trabajador_antiguo", () => {
    it("retorna habilitado_autonomo con >=90% sin bloqueos ni criticos", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        95,
        [],
      )
      expect(result).toBe("habilitado_autonomo")
    })

    it("retorna habilitado_restricciones con 70-89% sin bloqueos", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        80,
        [],
      )
      expect(result).toBe("habilitado_restricciones")
    })

    it("retorna no_habilitado con <70%", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        65,
        [],
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado si hay desviación crítica", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        95,
        [],
        true,
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado si hay reincidencia", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        95,
        [],
        false,
        true,
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado con bloqueo en procedimientos_criticos", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        95,
        [{ seccionId: "procedimientos_criticos", itemId: "procedimiento_escrito", estado: "no_cumple" as StatusValue }],
      )
      expect(result).toBe("no_habilitado")
    })

    it("retorna no_habilitado con bloqueo en control_ampliroll", () => {
      const result = getAutomaticResultadoFinal(
        "trabajador_antiguo",
        95,
        [{ seccionId: "control_ampliroll", itemId: "check_ampliroll", estado: "no" as StatusValue }],
      )
      expect(result).toBe("no_habilitado")
    })
  })
})

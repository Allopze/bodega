import { describe, expect, it } from "vitest"
import {
  buildWorkerPositionAutoCode,
  cleanWorkerPositionDisplayName,
  normalizeWorkerPositionKey,
} from "@/lib/services/worker-positions/normalization"

describe("catálogo de cargos — normalización", () => {
  it.each([
    "Operador",
    "operador",
    " OPERADOR ",
    "  Operador\t",
  ])("deduplica %j bajo la misma clave canónica", (value) => {
    expect(normalizeWorkerPositionKey(value)).toBe("operador")
  })

  it("elimina diacríticos y trata puntuación o espacios como separadores", () => {
    expect(normalizeWorkerPositionKey("  Técnico / Eléctrico — Móvil  ")).toBe(
      "tecnico electrico movil",
    )
    expect(normalizeWorkerPositionKey("Te\u0301cnico")).toBe("tecnico")
  })

  it("limpia el nombre visible sin destruir su capitalización", () => {
    expect(cleanWorkerPositionDisplayName("  Operador   de\tGrúa ")).toBe("Operador de Grúa")
  })

  it("genera un código automático estable para reintentos del mismo cargo", () => {
    expect(buildWorkerPositionAutoCode("operador de grua")).toBe("AUTO-C2A53E6FB262")
    expect(buildWorkerPositionAutoCode("operador de grua")).toBe("AUTO-C2A53E6FB262")
  })
})

import { describe, expect, it } from "vitest"
import {
  formatComplianceBasisPoints,
  formatInspectionAnswerValue,
  formatInspectionSubject,
} from "@/lib/prevention/inspection-answer-format"

const EXTINTOR = [
  { value: "pqs", label: "PQS (Polvo Químico Seco)" },
  { value: "co2", label: "CO₂ (Dióxido de carbono)" },
]

describe("formatInspectionAnswerValue", () => {
  it("un select muestra la etiqueta de la opción y no el valor guardado", () => {
    expect(formatInspectionAnswerValue({ kind: "select", options: EXTINTOR }, "pqs")).toBe("PQS (Polvo Químico Seco)")
  })

  it("un select con una opción que ya no existe conserva el valor guardado", () => {
    expect(formatInspectionAnswerValue({ kind: "select", options: EXTINTOR }, "agua")).toBe("agua")
  })

  it("un multiselect traduce cada valor y los separa con coma", () => {
    expect(formatInspectionAnswerValue({ kind: "multiselect", options: EXTINTOR }, "pqs, co2")).toBe("PQS (Polvo Químico Seco), CO₂ (Dióxido de carbono)")
  })

  it("una fecha usa el formato de la plataforma y no el ISO", () => {
    expect(formatInspectionAnswerValue({ kind: "date" }, "2026-10-19")).toBe("19-10-2026")
  })

  it("un texto o número se devuelve recortado", () => {
    expect(formatInspectionAnswerValue({ kind: "text" }, "  Pasillo norte  ")).toBe("Pasillo norte")
    expect(formatInspectionAnswerValue({ kind: "number" }, "134.5")).toBe("134.5")
  })

  it("sin ítem conocido tampoco inventa etiquetas", () => {
    expect(formatInspectionAnswerValue(null, "pqs")).toBe("pqs")
  })

  it("un valor vacío devuelve el marcador pedido y no una cadena en blanco", () => {
    expect(formatInspectionAnswerValue({ kind: "select", options: EXTINTOR }, null)).toBe("—")
    expect(formatInspectionAnswerValue({ kind: "text" }, "   ", "Sin respuesta")).toBe("Sin respuesta")
  })
})

describe("formatInspectionSubject", () => {
  it("traduce el tipo técnico y le suma el rótulo", () => {
    expect(formatInspectionSubject("vehicle", "KA122")).toBe("Vehículo · KA122")
  })

  it("sin rótulo muestra solo el tipo; sin tipo, solo el rótulo", () => {
    expect(formatInspectionSubject("contenedor", null)).toBe("Contenedor")
    expect(formatInspectionSubject(null, "Bodega 2")).toBe("Bodega 2")
  })

  it("un tipo libre que no está en el catálogo se conserva", () => {
    expect(formatInspectionSubject("Extintor", "pasillo")).toBe("Extintor · pasillo")
  })

  it("sin nada devuelve el marcador", () => {
    expect(formatInspectionSubject(null, "  ")).toBe("—")
  })
})

describe("formatComplianceBasisPoints", () => {
  it("convierte puntos base a porcentaje", () => {
    expect(formatComplianceBasisPoints(8000, "Aún no calculable")).toBe("80%")
    expect(formatComplianceBasisPoints(8350, "—")).toBe("83.5%")
  })

  it("sin cifra devuelve la etiqueta pedida", () => {
    expect(formatComplianceBasisPoints(null, "Sin fórmula en el documento")).toBe("Sin fórmula en el documento")
  })
})

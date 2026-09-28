import { describe, expect, it } from "vitest"
import { groupTemplatesByKind } from "./template-select"

const tpl = (id: string, name: string, kind: string | null, versionLabel = "01") => ({ id, name, kind, versionLabel })

describe("groupTemplatesByKind", () => {
  it("agrupa por tipo en el orden del catálogo y ordena por nombre dentro de cada grupo", () => {
    const groups = groupTemplatesByKind([
      tpl("1", "Reporte de Uso Diario de Equipos", "inspection"),
      tpl("2", "Observación planeada (Anexo 7)", "observation"),
      tpl("3", "caminata de seguridad", "inspection"),
      tpl("4", "Auditoría interna", "audit"),
      tpl("5", "Inspección de Carros", "inspection"),
      tpl("6", "Observación de Seguridad: Camión Ampliroll", "observation"),
    ])

    expect(groups.map((group) => group.label)).toEqual(["Inspección", "Observación planeada", "Auditoría"])
    expect(groups[0]?.items.map((item) => item.name)).toEqual([
      "caminata de seguridad",
      "Inspección de Carros",
      "Reporte de Uso Diario de Equipos",
    ])
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["6", "2"])
  })

  it("deja al final un tipo desconocido y desempata versiones del mismo nombre", () => {
    const groups = groupTemplatesByKind([
      tpl("a", "Extintores", "otro"),
      tpl("b", "Uso de EPP", "inspection", "03-prf"),
      tpl("c", "Uso de EPP", "inspection", "03-jt"),
    ])

    expect(groups.map((group) => group.kind)).toEqual(["inspection", "otro"])
    expect(groups[0]?.items.map((item) => item.versionLabel)).toEqual(["03-jt", "03-prf"])
    expect(groups[1]?.label).toBe("otro")
  })
})

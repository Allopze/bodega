/**
 * Reglas de catálogo de los ítems de servicio (colaborador obligatorio y
 * atributos tipados). Las comparten el formulario y el servicio de creación, así
 * que probarlas aquí cubre las dos capas a la vez.
 */
import { describe, it, expect } from "vitest"
import {
  attributeValueIssue,
  catalogItemIssues,
  quantityFromAttributes,
  COST_PENDING_LABEL,
  type CatalogProductRules,
} from "@/lib/products/service-items"

const VACUNA: CatalogProductRules = {
  name: "Vacuna",
  requiresWorker: true,
  attributes: [{ id: "pa-dosis", name: "Número de dosis", type: "integer", isRequired: true, drivesQuantity: true }],
}

const MONOGAS: CatalogProductRules = {
  name: "Mantención de monogás",
  requiresWorker: false,
  attributes: [
    { id: "pa-serie", name: "Código interno / N° de serie", type: "text", isRequired: true },
    { id: "pa-marca", name: "Marca", type: "text", isRequired: false },
  ],
}

describe("attributeValueIssue", () => {
  it("exige los atributos requeridos y deja pasar los opcionales vacíos", () => {
    expect(attributeValueIssue({ name: "Marca", type: "text", isRequired: false }, "")).toBeNull()
    expect(attributeValueIssue({ name: "Marca", type: "text", isRequired: true }, "  "))
      .toBe("completa Marca")
  })

  it("acepta enteros ≥ 1 en un atributo integer", () => {
    for (const value of ["1", "2", "12"]) {
      expect(attributeValueIssue({ name: "Número de dosis", type: "integer", isRequired: true }, value)).toBeNull()
    }
  })

  it("rechaza cero, negativos, decimales y texto en un atributo integer", () => {
    for (const value of ["0", "-1", "2.5", "1,5", "dos", "1e3"]) {
      expect(attributeValueIssue({ name: "Número de dosis", type: "integer", isRequired: true }, value))
        .toBe("Número de dosis debe ser un número entero mayor o igual a 1")
    }
  })

  it("un atributo number sí admite decimales", () => {
    expect(attributeValueIssue({ name: "Medida", type: "number", isRequired: true }, "2.5")).toBeNull()
    expect(attributeValueIssue({ name: "Medida", type: "number", isRequired: true }, "dos"))
      .toBe("Medida debe ser un número válido")
  })
})

describe("catalogItemIssues", () => {
  it("una vacuna sin colaborador ni dosis reporta ambos problemas", () => {
    expect(catalogItemIssues(VACUNA, { workerId: null, attributes: [] })).toEqual([
      "selecciona el colaborador para Vacuna",
      "completa Número de dosis",
    ])
  })

  it("una vacuna completa no reporta nada", () => {
    expect(catalogItemIssues(VACUNA, {
      workerId: "worker-1",
      attributes: [{ attributeId: "pa-dosis", attributeName: "Número de dosis", value: "2" }],
    })).toEqual([])
  })

  it("valida las dosis por nombre cuando el payload no trae el attributeId", () => {
    expect(catalogItemIssues(VACUNA, {
      workerId: "worker-1",
      attributes: [{ attributeId: null, attributeName: "número de dosis", value: "0" }],
    })).toEqual(["Número de dosis debe ser un número entero mayor o igual a 1"])
  })

  it("un servicio sin colaborador sólo exige lo que su catálogo declara", () => {
    expect(catalogItemIssues(MONOGAS, {
      workerId: null,
      attributes: [{ attributeId: "pa-serie", attributeName: "Código interno / N° de serie", value: "MG-014" }],
    })).toEqual([])

    expect(catalogItemIssues(MONOGAS, { workerId: null, attributes: [] }))
      .toEqual(["completa Código interno / N° de serie"])
  })

  it("un producto sin reglas (EPP corriente) nunca reporta problemas", () => {
    expect(catalogItemIssues(
      { name: "Casco", requiresWorker: false, attributes: [] },
      { workerId: null, attributes: [] },
    )).toEqual([])
  })
})

describe("quantityFromAttributes", () => {
  it("la cantidad del ítem la manda el nº de dosis", () => {
    expect(quantityFromAttributes(VACUNA, {
      workerId: "w-1",
      attributes: [{ attributeId: "pa-dosis", attributeName: "Número de dosis", value: "3" }],
    })).toBe(3)
  })

  it("resuelve el atributo por nombre cuando no viene el id", () => {
    expect(quantityFromAttributes(VACUNA, {
      attributes: [{ attributeId: null, attributeName: "número de dosis", value: "2" }],
    })).toBe(2)
  })

  it("no impone cantidad si el valor no es un entero ≥ 1", () => {
    for (const value of ["", "0", "-1", "2.5", "tres"]) {
      expect(quantityFromAttributes(VACUNA, {
        attributes: [{ attributeId: "pa-dosis", attributeName: "Número de dosis", value }],
      })).toBeNull()
    }
  })

  it("un producto sin atributo gobernante deja la cantidad al solicitante", () => {
    expect(quantityFromAttributes(MONOGAS, {
      attributes: [{ attributeId: "pa-serie", attributeName: "Código interno / N° de serie", value: "MG-1" }],
    })).toBeNull()
  })
})

describe("COST_PENDING_LABEL", () => {
  it("no representa el costo desconocido como un monto", () => {
    expect(COST_PENDING_LABEL).toBe("Costo pendiente")
    expect(COST_PENDING_LABEL).not.toMatch(/\$|\b0\b/)
  })
})

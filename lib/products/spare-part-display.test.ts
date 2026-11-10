import { describe, expect, it } from "vitest"
import {
  CATALOG_PART_NUMBER_LABEL, REQUESTED_PART_NUMBER_LABEL, attributeDisplayName, isFreePartNumberAttribute, withCatalogPartNumber,
} from "./spare-part-display"

const RECORDED = [
  { attributeName: "N° de Parte", value: "1r 0750" },
  { attributeName: "Equipo", value: "Camión KA-135" },
]

describe("withCatalogPartNumber", () => {
  it("con un repuesto de catálogo, el N° de parte libre se reemplaza por el del repuesto, una sola vez", () => {
    expect(withCatalogPartNumber({ isSparePart: true, partNumber: "1R-0750" }, RECORDED)).toEqual([
      { attributeName: CATALOG_PART_NUMBER_LABEL, value: "1R-0750" },
      { attributeName: "Equipo", value: "Camión KA-135" },
    ])
  })

  it("si el número que se pidió es otro, se ven los dos, cada uno con su rótulo", () => {
    expect(withCatalogPartNumber({ isSparePart: true, partNumber: "1R-0751" }, RECORDED)).toEqual([
      { attributeName: CATALOG_PART_NUMBER_LABEL, value: "1R-0751" },
      { attributeName: REQUESTED_PART_NUMBER_LABEL, value: "1r 0750" },
      { attributeName: "Equipo", value: "Camión KA-135" },
    ])
  })

  it("un repuesto sin N° de parte deja a la vista el que se pidió, rotulado", () => {
    expect(withCatalogPartNumber({ isSparePart: true, partNumber: null }, RECORDED)).toEqual([
      { attributeName: REQUESTED_PART_NUMBER_LABEL, value: "1r 0750" },
      { attributeName: "Equipo", value: "Camión KA-135" },
    ])
  })

  it("sin repuesto, o con un producto que no es repuesto, sólo rotula el N° de parte libre como el catálogo", () => {
    const relabeled = [{ attributeName: "N° de parte", value: "1r 0750" }, { attributeName: "Equipo", value: "Camión KA-135" }]
    expect(withCatalogPartNumber(null, RECORDED)).toEqual(relabeled)
    expect(withCatalogPartNumber({ isSparePart: false, partNumber: "X" }, RECORDED)).toEqual(relabeled)
    expect(withCatalogPartNumber({ isSparePart: true, partNumber: "X" }, undefined)).toEqual([
      { attributeName: CATALOG_PART_NUMBER_LABEL, value: "X" },
    ])
  })

  it("el nombre guardado «N° de Parte» se muestra «N° de parte»; los demás, igual", () => {
    expect(attributeDisplayName("N° de Parte")).toBe("N° de parte")
    expect(attributeDisplayName("Equipo")).toBe("Equipo")
  })

  it("reconoce el atributo libre sin importar mayúsculas ni espacios", () => {
    expect(isFreePartNumberAttribute(" n° de parte ")).toBe(true)
    expect(isFreePartNumberAttribute("Marca")).toBe(false)
  })
})

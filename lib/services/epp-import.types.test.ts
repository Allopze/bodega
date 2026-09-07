/**
 * Inferencia de tipo EPP desde el nombre del producto.
 *
 * El tipo inferido termina en `epp_product_families.epp_type_id`, que es el
 * segundo INNER JOIN de `computeEppCoverageGaps`: un tipo equivocado no deja
 * la familia sin clasificar, la acredita en la zona corporal errónea. De ahí
 * que estos casos vengan del catálogo real y no de nombres inventados.
 */
import { describe, expect, it } from "vitest"
import { inferEppItemType, EPP_TYPE_TO_BODY_PART_CODE } from "./epp-import.types"

const bodyPart = (name: string) => {
  const item = inferEppItemType(name)
  return item ? EPP_TYPE_TO_BODY_PART_CODE[item] ?? null : null
}

describe("inferEppItemType", () => {
  it("keeps the existing item vocabulary working", () => {
    expect(inferEppItemType("Casco Activex I")).toBe("casco")
    expect(inferEppItemType("PANTALÓN DE TRABAJO")).toBe("pantalon")
    expect(inferEppItemType("Guante Activex Nitrilo Heavy Duty")).toBe("guante")
    expect(inferEppItemType("Mascarilla plegable KN95 sin válvula")).toBe("mascarilla")
  })

  it("does not read the helmet a hearing protector mounts on as head protection", () => {
    // Sin esto, EPP-049/050/TRECK-019 se acreditaban como "cabeza".
    expect(bodyPart("Fono HL Verishield VS120DH p/casco Dielec")).toBe("auditiva")
    expect(bodyPart("Fono HL Verishield p/casco dieléctrico")).toBe("auditiva")
    expect(bodyPart("Fono HL Verishield cintillo")).toBe("auditiva")
  })

  it("still classifies the accessory's own item when it leads the name", () => {
    expect(bodyPart("Visor Activex policarbonato c/porta visor")).toBe("ojos_cara")
    expect(bodyPart("Casquete ABS Porta Visor")).toBe("cabeza")
  })

  it("matches plural item names", () => {
    expect(inferEppItemType("Guantes de cabritilla")).toBe("guante")
  })

  it("classifies footwear named 'bota' and not only 'botin'", () => {
    expect(bodyPart("Bota Proflex Soldador")).toBe("pies")
    expect(bodyPart("Bota PVC Segusa Pegasus C/P y Plantilla")).toBe("pies")
    expect(bodyPart("Botin V-Flex Microfiber")).toBe("pies")
  })

  it("classifies the clothing the catalog actually carries", () => {
    expect(bodyPart("Camisa Absolute Zero Lightwind H2600")).toBe("cuerpo")
    expect(bodyPart("Polera Polo Dryfresh dama")).toBe("cuerpo")
    expect(bodyPart("Blusa Absolute Zero Lightwind Poliéster")).toBe("cuerpo")
    expect(bodyPart("Overol Activex Piloto Poplin c/reflectante")).toBe("cuerpo")
    expect(bodyPart("JARDINERA TERMICA  L")).toBe("cuerpo")
    expect(bodyPart("Primera Capa Activex polyester")).toBe("cuerpo")
    expect(bodyPart("Coleto Activex Soldador Cuero Tr.")).toBe("cuerpo")
  })

  it("classifies head and respiratory items the vocabulary was missing", () => {
    expect(bodyPart("Gorro Legionario Activex")).toBe("cabeza")
    expect(bodyPart("Barbiquejo Gancho Plastico C/Mentonera")).toBe("cabeza")
    expect(bodyPart("Filtro Activex vapores orgánicos y gases ácidos")).toBe("respiratoria")
    expect(bodyPart("Mascara soldar Activex Fotosensible WH3716")).toBe("ojos_cara")
  })

  it("leaves genuinely non-PPE catalog items unclassified", () => {
    // Mejor nulo que una zona corporal inventada: estos no protegen nada.
    for (const name of [
      "ALCOTEST DIGITAL MARS",
      "BORDADO ESPALDA",
      "Botiquin Activex de Primeros Auxilios 10 Personas",
      "Boquillas Mars-Satellite",
      "Protector Solar FPS 50 Leblon 1 Kg. C/Valvula",
      "ANPHOTEROL CARA/MANOS 200ml",
      "ESTUCHE PORTA MINIESCAPE",
    ]) {
      expect(bodyPart(name), name).toBeNull()
    }
  })
})

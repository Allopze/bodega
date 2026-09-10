/**
 * Inferencia de tipo EPP desde el nombre del producto.
 *
 * El tipo inferido termina en `epp_product_families.epp_type_id`, que es el
 * segundo INNER JOIN de `computeEppCoverageGaps`: un tipo equivocado no deja
 * la familia sin clasificar, la acredita en la zona corporal errónea. De ahí
 * que estos casos vengan del catálogo real y no de nombres inventados.
 */
import { describe, expect, it } from "vitest"
import {
  inferEppItemType,
  EPP_TYPE_TO_BODY_PART_CODE,
  EPP_TYPE_TO_SIZE_FAMILY,
  sizeFamilyForEppType,
  resolveSizeAttribute,
} from "./epp-import.types"
import { SIZE_FAMILIES } from "@/lib/products/size-catalog"

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

describe("sizeFamilyForEppType", () => {
  const familyOf = (name: string) => sizeFamilyForEppType(inferEppItemType(name))

  it("asigna la familia por el ítem que declara el nombre", () => {
    expect(familyOf("Guante Nitrilo Showa")).toBe("guantes")
    expect(familyOf("Botin de seguridad SteelPro")).toBe("calzado")
    expect(familyOf("Bota de agua")).toBe("calzado")
    expect(familyOf("Casco Activex I")).toBe("casco")
    expect(familyOf("Casquete ABS Porta Visor")).toBe("casco")
    expect(familyOf("Overol Activex Piloto Poplin")).toBe("ropa")
    expect(familyOf("Chaleco reflectante")).toBe("ropa")
  })

  it("manda el pantalón a su propia familia, para que cruce con la talla de abajo", () => {
    // `pantalon` y `ropa` comparten la escala de letras; lo que las distingue es
    // con qué campo del padrón cruzan. Un trabajador puede ser L arriba y XL
    // abajo, y `size_top`/`size_bottom` existen para capturar esa diferencia.
    expect(familyOf("Pantalón de trabajo")).toBe("pantalon")
  })

  it("sizea el conjunto por la talla de arriba, no por la prenda suelta", () => {
    expect(familyOf("JARDINERA TERMICA")).toBe("ropa")
    expect(familyOf("Overol Activex Piloto")).toBe("ropa")
    expect(familyOf("Buzo Dupont Tyvek 500X")).toBe("ropa")
    // Un traje se sizea como conjunto aunque venga en dos piezas: el pantalón
    // de un traje PU lleva la talla del traje, no una talla de pantalón. Que
    // `inferEppItemType` lo lea como `traje` es lo correcto.
    expect(familyOf("Traje PU Verde Activex Pantalón")).toBe("ropa")
    expect(familyOf("Traje para lluvia Activex Azul")).toBe("ropa")
  })

  it("devuelve null para los ítems que no tienen escala de talla", () => {
    expect(familyOf("Lente Activex FX III sellado")).toBeNull()
    expect(familyOf("Mascarilla plegable KN95 sin válvula")).toBeNull()
    expect(familyOf("Arnés de cuerpo completo")).toBeNull()
    expect(familyOf("Fono HL Verishield cintillo")).toBeNull()
    expect(familyOf("Respirador media cara")).toBeNull()
  })

  it("devuelve null cuando el nombre no declara ningún ítem", () => {
    expect(sizeFamilyForEppType(null)).toBeNull()
    expect(sizeFamilyForEppType("no-es-un-tipo")).toBeNull()
  })

  it("sólo usa familias que el catálogo canónico declara", () => {
    const known = new Set(SIZE_FAMILIES.map((definition) => definition.family))
    for (const family of Object.values(EPP_TYPE_TO_SIZE_FAMILY)) {
      expect(known).toContain(family)
    }
  })
})

describe("resolveSizeAttribute", () => {
  it("nombra el atributo con la familia del ítem, no con una heurística de dos dígitos", () => {
    expect(resolveSizeAttribute(["M"], "guante").name).toBe("Talla guantes")
    expect(resolveSizeAttribute(["42"], "botin").name).toBe("Talla calzado")
    expect(resolveSizeAttribute(["L"], "casco").name).toBe("Talla casco")
    expect(resolveSizeAttribute(["XL"], "overol").name).toBe("Talla")
  })

  it("canoniza el valor con la regla compartida", () => {
    expect(resolveSizeAttribute(["T/L"], "guante").values).toEqual(["L"])
    expect(resolveSizeAttribute(["XXXL"], "overol").values).toEqual(["3XL"])
    expect(resolveSizeAttribute(["42.0"], "botin").values).toEqual(["42"])
    expect(resolveSizeAttribute(["Mediana"], "overol").values).toEqual(["M"])
  })

  it("declara la familia para que la variante pueda cruzarse con el padrón", () => {
    expect(resolveSizeAttribute(["M"], "guante").sizeFamily).toBe("guantes")
    expect(resolveSizeAttribute(["42"], "botin").sizeFamily).toBe("calzado")
  })

  it("no inventa familia para un ítem que no se sizea", () => {
    const resolved = resolveSizeAttribute(["M"], "lente")
    expect(resolved.name).toBe("Talla")
    expect(resolved.sizeFamily).toBeNull()
    expect(resolved.issues).toEqual([])
  })

  it("acepta con advertencia no bloqueante una talla fuera del catálogo de su familia", () => {
    const resolved = resolveSizeAttribute(["Talla 9-10"], "guante")
    expect(resolved.values).toEqual(["9/10"])
    expect(resolved.sizeFamily).toBe("guantes")
    expect(resolved.issues).toHaveLength(1)
    expect(resolved.issues[0]!.severity).toBe("warning")
    expect(resolved.issues[0]!.message).toContain("9/10")
    expect(resolved.issues[0]!.message).toContain("guantes")
  })

  it("no advierte cuando el valor sí está en el catálogo de su familia", () => {
    expect(resolveSizeAttribute(["2XL"], "guante").issues).toEqual([])
  })

  it("resuelve todas las tallas de una fila multi-talla", () => {
    const resolved = resolveSizeAttribute(["S", "M", "L", "XL"], "guante")
    expect(resolved.name).toBe("Talla guantes")
    expect(resolved.values).toEqual(["S", "M", "L", "XL"])
    expect(resolved.issues).toEqual([])
  })

  it("advierte por cada talla fuera de catálogo de una fila multi-talla", () => {
    const resolved = resolveSizeAttribute(["S", "9-10"], "guante")
    expect(resolved.values).toEqual(["S", "9/10"])
    expect(resolved.issues).toHaveLength(1)
  })

  it("deduplica valores que canonizan al mismo código", () => {
    // "XXL" y "2XL" son la misma talla escrita distinto: sin deduplicar,
    // `toUpperCase` nunca las hubiera dejado iguales, pero `normalizeSizeLabel`
    // sí, y el resultado repetía tanto el valor como su advertencia.
    const resolved = resolveSizeAttribute(["XXL", "2XL"], "overol")
    expect(resolved.values).toEqual(["2XL"])
  })

  it("valida contra los códigos inyectados y no contra la semilla", () => {
    // Ésta es la ruta real del servidor: los códigos vienen de `size_catalog`,
    // donde una talla puede estar dada de baja o haberse agregado.
    const options = [{ family: "guantes", attributeName: "Talla guantes", codes: ["S", "M"] }]
    expect(resolveSizeAttribute(["M"], "guante", options).issues).toEqual([])
    expect(resolveSizeAttribute(["XL"], "guante", options).issues).toHaveLength(1)
  })

  it("usa el nombre de atributo que declaran los códigos inyectados", () => {
    const options = [{ family: "guantes", attributeName: "Talla de guante", codes: ["M"] }]
    expect(resolveSizeAttribute(["M"], "guante", options).name).toBe("Talla de guante")
  })

  it("descarta un valor que no deja ninguna talla al normalizarse", () => {
    // `normalizeSizeLabel(".")` es `""` a propósito. Resucitarlo con otra regla
    // sería la segunda fuente de verdad que el hallazgo F-5 cerró.
    const resolved = resolveSizeAttribute(["."], "guante")
    expect(resolved.values).toEqual([])
    expect(resolved.issues).toEqual([])
  })

  it("conserva las tallas válidas de una fila que trae una celda basura", () => {
    const resolved = resolveSizeAttribute(["M", ".", "L"], "guante")
    expect(resolved.values).toEqual(["M", "L"])
    expect(resolved.issues).toEqual([])
  })
})

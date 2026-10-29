import { describe, expect, it } from "vitest"
import { closestVariant, getVariantAxes, resolveVariantForChoice } from "./variant-selector.helpers"
import type { ProductOption } from "./request-form.types"

type Attrs = Record<string, string>

function product(id: string, attrs: Attrs, sku = `BOT-${id}`): ProductOption {
  return {
    id,
    sku,
    name: "Botín de seguridad",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    unitOfMeasure: "par",
    categoryName: "Calzado",
    referencePrice: null,
    familyId: "botin-seguridad",
    preferredSupplierId: null,
    attributes: Object.entries(attrs).map(([name, value]) => ({
      id: `${id}-${name}`, name, type: "select", isRequired: true, drivesQuantity: false, options: JSON.stringify([value]),
    })),
  }
}

function variant(id: string, size: string, attributeName = "Talla calzado"): ProductOption {
  return product(id, { [attributeName]: size }, `BOT-${size}`)
}

const labels = (variants: ProductOption[], selectedId: string, axis = 0) =>
  getVariantAxes(variants, selectedId)?.[axis]?.choices.map((choice) => choice.label)

describe("getVariantAxes — talla", () => {
  it("convierte una familia que sólo varía en talla en un selector", () => {
    expect(getVariantAxes([variant("36", "36"), variant("37", "37")], "36")).toEqual([{
      key: "talla",
      attributeName: "Talla calzado",
      choices: [{ value: "36", label: "36" }, { value: "37", label: "37" }],
      selected: "36",
    }])
  })

  it("ofrece talla aunque la familia tenga una fila histórica sin talla, y la deja fuera", () => {
    const unsized = product("legacy", { Color: "Amarillo" })
    const axes = getVariantAxes([unsized, variant("l", "T/L", "Talla"), variant("s", "T/S", "Talla")], "l")
    expect(axes?.map((axis) => axis.attributeName)).toEqual(["Talla"])
    expect(axes?.[0]?.choices).toEqual([{ value: "S", label: "T/S" }, { value: "L", label: "T/L" }])
  })

  it("con la fila sin talla seleccionada no marca ninguna talla", () => {
    const unsized = product("legacy", { Color: "Amarillo" })
    expect(getVariantAxes([unsized, variant("l", "T/L", "Talla")], "legacy")?.[0]?.selected).toBeNull()
  })

  it("sin ningún atributo que distinga las variantes no hay selectores", () => {
    expect(getVariantAxes([product("a", {}), product("b", {})], "a")).toBeNull()
  })

  it("ofrece una talla repetida una sola vez, apuntando a la variante de SKU menor", () => {
    const variants = [{ ...variant("b", "M"), sku: "EPP-200" }, { ...variant("a", "M"), sku: "EPP-100" }, variant("l", "L")]
    expect(labels(variants, "l")).toEqual(["M", "L"])
    expect(resolveVariantForChoice(variants, "l", "talla", "M")).toBe("a")
  })

  it("agrupa las tallas aunque el atributo venga con nombres distintos (migración parcial)", () => {
    // Una familia de guantes re-importada fila por fila queda con
    // `Talla guantes` en la variante nueva y `Talla` (legacy) en el resto:
    // es el estado intermedio esperado de la migración de este proyecto, no
    // un error que deba ocultar el selector completo.
    const axes = getVariantAxes([variant("36", "36"), variant("37", "37", "Talla guantes")], "36")
    expect(axes?.map((axis) => axis.attributeName)).toEqual(["Talla calzado"])
    expect(axes?.[0]?.choices.map((choice) => choice.label)).toEqual(["36", "37"])
  })

  it("trata `T/L` y `L` como la misma talla y la ofrece una vez", () => {
    // `T/L` canoniza a `L` (abreviatura de "Talla"): si la familia también
    // tiene una variante ya escrita `L`, son la misma talla dos veces.
    const variants = [variant("a", "T/L", "Talla"), variant("b", "L", "Talla"), variant("s", "S", "Talla")]
    expect(getVariantAxes(variants, "a")?.[0]?.choices).toEqual([{ value: "S", label: "S" }, { value: "L", label: "L" }])
    // Llegando desde otra talla, la de SKU menor; si ya está en un duplicado,
    // no salta al otro (sería cambiar de producto sin cambiar nada visible).
    expect(resolveVariantForChoice(variants, "s", "talla", "L")).toBe("b")
    expect(resolveVariantForChoice(variants, "a", "talla", "L")).toBe("a")
  })

  it("no ofrece dos veces la misma talla escrita distinto", () => {
    expect(getVariantAxes([variant("a", "42"), variant("b", "42.0")], "b")?.[0]?.choices).toEqual([{ value: "42", label: "42" }])
  })

  it("ordena las tallas por escala y no por el orden de la consulta", () => {
    const variants = [
      variant("l", "L", "Talla"), variant("xs", "XS", "Talla"),
      variant("m", "M", "Talla"), variant("xl", "XL", "Talla"),
      variant("s", "S", "Talla"),
    ]
    expect(labels(variants, "m")).toEqual(["XS", "S", "M", "L", "XL"])
  })

  it("ordena las tallas numéricas por valor", () => {
    expect(labels([variant("40", "40"), variant("9", "9"), variant("38", "38"), variant("10", "10")], "9"))
      .toEqual(["9", "10", "38", "40"])
  })
})

describe("getVariantAxes — atributos además de la talla", () => {
  // El caso que motivó esto: el importador saca el color del nombre y la
  // familia se identifica sin él, así que «Botín negro» y «Botín café» quedan
  // en la misma familia. Con un solo selector de talla, la talla 42 apuntaba a
  // la variante de SKU menor y el color café no se podía pedir.
  const BOTIN = [
    product("42-negro", { "Talla calzado": "42", Color: "Negro" }, "EPP-001"),
    product("42-cafe", { "Talla calzado": "42", Color: "Café" }, "EPP-002"),
    product("43-negro", { "Talla calzado": "43", Color: "Negro" }, "EPP-003"),
    product("43-cafe", { "Talla calzado": "43", Color: "Café" }, "EPP-004"),
    product("44-negro", { "Talla calzado": "44", Color: "Negro" }, "EPP-005"),
  ]

  it("ofrece talla y color cuando la familia mezcla colores en la misma talla", () => {
    expect(getVariantAxes(BOTIN, "42-negro")).toEqual([
      {
        key: "talla",
        attributeName: "Talla calzado",
        choices: [{ value: "42", label: "42" }, { value: "43", label: "43" }, { value: "44", label: "44" }],
        selected: "42",
      },
      {
        key: "color",
        attributeName: "Color",
        choices: [{ value: "cafe", label: "Café" }, { value: "negro", label: "Negro" }],
        selected: "negro",
      },
    ])
  })

  it("elegir otro color cambia a esa variante sin tocar la talla", () => {
    expect(resolveVariantForChoice(BOTIN, "43-negro", "color", "cafe")).toBe("43-cafe")
  })

  it("cambiar la talla conserva el color elegido", () => {
    expect(resolveVariantForChoice(BOTIN, "42-cafe", "talla", "43")).toBe("43-cafe")
  })

  it("si el color elegido no existe en la talla nueva, cae en el que sí hay", () => {
    expect(resolveVariantForChoice(BOTIN, "42-cafe", "talla", "44")).toBe("44-negro")
  })

  it("sólo ofrece los colores que existen en la talla elegida", () => {
    expect(labels(BOTIN, "44-negro", 1)).toEqual(["Negro"])
  })

  it("un atributo igual en todas las variantes no es un selector", () => {
    const withLogo = BOTIN.map((variant) => ({
      ...variant,
      attributes: [...variant.attributes, { id: `${variant.id}-logo`, name: "Logo", type: "select", isRequired: true, drivesQuantity: false, options: JSON.stringify(["Con logo"]) }],
    }))
    expect(getVariantAxes(withLogo, "42-negro")?.map((axis) => axis.attributeName)).toEqual(["Talla calzado", "Color"])
  })

  it("no confunde el mismo atributo escrito con otra caja o sin tilde", () => {
    const variants = [
      product("dama-s", { Talla: "S", Género: "Dama" }),
      product("hombre-s", { Talla: "S", genero: "hombre" }),
    ]
    const axes = getVariantAxes(variants, "dama-s")
    expect(axes?.map((axis) => axis.attributeName)).toEqual(["Talla", "Género"])
    expect(axes?.[1]?.choices).toEqual([{ value: "dama", label: "Dama" }, { value: "hombre", label: "hombre" }])
  })

  it("una variante que no declara el atributo se ofrece como «Sin especificar»", () => {
    // Catálogo real (Guante Activex Nitrilo): la talla L existe una vez con
    // `Color: Rojo` y otra sin color. Las dos tienen que poder pedirse.
    const variants = [
      product("sin-color", { Talla: "T/L" }, "EPP-056"),
      product("rojo", { Talla: "L", Color: "Rojo" }, "EPP-060"),
    ]
    const axes = getVariantAxes(variants, "sin-color")
    expect(axes?.[1]).toMatchObject({
      attributeName: "Color",
      choices: [{ label: "Rojo" }, { label: "Sin especificar" }],
    })
    const unspecified = axes?.[1]?.choices.find((choice) => choice.label === "Sin especificar")
    expect(axes?.[1]?.selected).toBe(unspecified?.value)
    expect(resolveVariantForChoice(variants, "sin-color", "color", "rojo")).toBe("rojo")
    expect(resolveVariantForChoice(variants, "rojo", "color", unspecified!.value)).toBe("sin-color")
  })

  it("una familia sin tallas que varía en color ofrece sólo el color", () => {
    const variants = [product("gris", { Color: "Gris" }), product("negro", { Color: "Negro" })]
    expect(getVariantAxes(variants, "gris")?.map((axis) => axis.attributeName)).toEqual(["Color"])
  })
})

describe("closestVariant", () => {
  const BOTIN = [
    product("42-negro", { "Talla calzado": "42", Color: "Negro" }, "EPP-001"),
    product("42-cafe", { "Talla calzado": "42", Color: "Café" }, "EPP-002"),
    product("43-negro", { "Talla calzado": "43", Color: "Negro" }, "EPP-003"),
    product("43-cafe", { "Talla calzado": "43", Color: "Café" }, "EPP-004"),
  ]

  it("entre las candidatas elige la que conserva lo ya elegido", () => {
    // La talla habitual del colaborador cambia la talla, no el color.
    const candidates = BOTIN.filter((variant) => variant.id.startsWith("43"))
    expect(closestVariant(BOTIN, "42-cafe", candidates)?.id).toBe("43-cafe")
  })

  it("si la variante actual ya es candidata, se queda en ella", () => {
    const duplicate = { ...product("42-cafe-bis", { "Talla calzado": "42", Color: "Café" }), sku: "EPP-000" }
    const variants = [...BOTIN, duplicate]
    const candidates = variants.filter((variant) => variant.id.startsWith("42"))
    expect(closestVariant(variants, "42-cafe", candidates)?.id).toBe("42-cafe")
  })

  it("sin candidatas no propone nada", () => {
    expect(closestVariant(BOTIN, "42-cafe", [])).toBeNull()
  })
})

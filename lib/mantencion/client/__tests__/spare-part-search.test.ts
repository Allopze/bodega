import { describe, expect, it } from "vitest"
import { partsNoteSchema } from "../../contracts"
import { partsNoteInput } from "../parts-request-model"
import {
  buildSparePartIndex, catalogSpareParts, fillFromSparePart, SPARE_PART_MIN_QUERY, SPARE_PART_RESULTS, searchSpareParts, sparePartCodes,
} from "../spare-part-search"
import { UUID, catalog, sparePart } from "./fixtures"

/** Un catálogo chico y realista: nombres con tildes, códigos con guiones y N° de parte con y sin ellos. */
const PARTS = [
  sparePart({ id: "p-aceite", name: "Filtro de aceite motor", sku: "REP-0001", partNumber: "1R-0750" }),
  sparePart({ id: "p-aire", name: "Filtro de aire primario", sku: "REP-0002", partNumber: "AF 25957" }),
  sparePart({ id: "p-valvula", name: "Válvula solenoide 24V", sku: "REP-0003", partNumber: null }),
  sparePart({ id: "p-aceite-hid", name: "Aceite hidráulico ISO 68", sku: "REP-0004", partNumber: "HYD-68", unit: "litro" }),
  sparePart({ id: "p-manguera", name: "Manguera hidráulica 1/2", sku: "REP-0005", partNumber: "MH-12", unit: "metro" }),
]
const index = buildSparePartIndex(PARTS)
const names = (query: string) => searchSpareParts(index, query).results.map((part) => part.name)

describe("buscador de repuestos: filtra local, sin tildes ni mayúsculas", () => {
  it("por nombre, sin importar tildes ni mayúsculas", () => {
    expect(names("valvula")).toEqual(["Válvula solenoide 24V"])
    expect(names("VÁLVULA")).toEqual(["Válvula solenoide 24V"])
    expect(names("  hidraulico ")).toEqual(["Aceite hidráulico ISO 68"])
    expect(names("hidraulic")).toEqual(["Aceite hidráulico ISO 68", "Manguera hidráulica 1/2"])
  })

  it("por código (SKU) y por N° de parte, con o sin guiones y espacios", () => {
    expect(names("REP-0003")).toEqual(["Válvula solenoide 24V"])
    expect(names("rep0003")).toEqual(["Válvula solenoide 24V"])
    expect(names("1r-0750")).toEqual(["Filtro de aceite motor"])
    expect(names("1R0750")).toEqual(["Filtro de aceite motor"])
    expect(names("af25957")).toEqual(["Filtro de aire primario"])
    expect(names("AF 25957")).toEqual(["Filtro de aire primario"])
  })

  it("varias palabras: todas tienen que estar, en cualquier orden y repartidas entre nombre y código", () => {
    expect(names("filtro aceite")).toEqual(["Filtro de aceite motor"])
    expect(names("aceite filtro")).toEqual(["Filtro de aceite motor"])
    expect(names("filtro 0750")).toEqual(["Filtro de aceite motor"])
    expect(names("filtro valvula")).toEqual([])
  })

  it("el código exacto va primero; luego los que empiezan con lo escrito; luego los que sólo lo contienen", () => {
    const ranked = buildSparePartIndex([
      sparePart({ id: "c", name: "Sello del aceite", sku: "REP-0010", partNumber: "SA-1" }),
      sparePart({ id: "b", name: "Aceite de motor 15W40", sku: "REP-0011", partNumber: "AM-1" }),
      sparePart({ id: "a", name: "Tapa", sku: "ACEITE", partNumber: null }),
    ])
    expect(searchSpareParts(ranked, "aceite").results.map((part) => part.id)).toEqual(["a", "b", "c"])
  })

  it("con menos de dos letras o sin catálogo no devuelve nada, y no inventa coincidencias", () => {
    expect(SPARE_PART_MIN_QUERY).toBe(2)
    expect(searchSpareParts(index, "").results).toEqual([])
    expect(searchSpareParts(index, " a ").results).toEqual([])
    expect(searchSpareParts(buildSparePartIndex([]), "filtro")).toEqual({ results: [], total: 0 })
    expect(names("zzzz")).toEqual([])
  })

  it("muestra pocas a la vez pero dice cuántas calzan en total", () => {
    const many = buildSparePartIndex(Array.from({ length: 20 }, (_, n) => sparePart({ id: `p-${n}`, name: `Rodamiento ${String(n).padStart(2, "0")}`, sku: `ROD-${n}`, partNumber: null })))
    const found = searchSpareParts(many, "rodamiento")
    expect(found.results).toHaveLength(SPARE_PART_RESULTS)
    expect(found.total).toBe(20)
    expect(found.results.map((part) => part.name)).toEqual(["Rodamiento 00", "Rodamiento 01", "Rodamiento 02", "Rodamiento 03", "Rodamiento 04", "Rodamiento 05"])
    expect(searchSpareParts(many, "rodamiento 1", 3).results).toHaveLength(3)
  })

  it("de un id vuelve al repuesto elegido", () => {
    expect(index.byId.get("p-valvula")?.sku).toBe("REP-0003")
    expect(index.byId.get("p-nope")).toBeUndefined()
  })
})

describe("lo que rellena un repuesto elegido", () => {
  it("descripción, unidad, N° de parte y su id; sin N° de parte, vacío", () => {
    expect(fillFromSparePart(PARTS[3]!)).toEqual({ productId: "p-aceite-hid", description: "Aceite hidráulico ISO 68", unit: "litro", partNumber: "HYD-68" })
    expect(fillFromSparePart(PARTS[2]!).partNumber).toBe("")
  })

  it("el código se dice con el N° de parte sólo si lo hay", () => {
    expect(sparePartCodes(PARTS[0]!)).toBe("REP-0001 · N° 1R-0750")
    expect(sparePartCodes(PARTS[2]!)).toBe("REP-0003")
  })

  it("un catálogo antiguo (sin repuestos) o sin catálogo ofrece sólo texto libre", () => {
    expect(catalogSpareParts(catalog("u-1"))).toEqual([])
    expect(catalogSpareParts(null)).toEqual([])
    expect(catalogSpareParts({ ...catalog("u-1"), spareParts: PARTS })).toHaveLength(5)
  })
})

describe("el pedido que arma la app lleva el repuesto del catálogo o texto libre", () => {
  const base = { id: UUID(1), deviceId: UUID(900), appVersion: "test", createdAt: "2026-11-27T12:00:00.000Z", worksiteId: "ws-bio", equipmentStopped: false, notes: "" }

  it("una línea elegida del catálogo viaja con productId y su unidad; la libre, con productId nulo y «unidad»", () => {
    const parsed = partsNoteSchema.parse(partsNoteInput({
      ...base,
      lines: [
        { description: "Aceite hidráulico ISO 68", quantity: 3, partNumber: "HYD-68", charge: "", productId: "p-aceite-hid", unit: "litro" },
        { description: "Silicona gris", quantity: 1, partNumber: "", charge: "" },
        { description: "Algo suelto", quantity: 1, partNumber: "", charge: "", productId: null, unit: "litro" },
      ],
    }))
    expect(parsed.lines.map((line) => [line.productId, line.unitOfMeasure, line.partNumber])).toEqual([
      ["p-aceite-hid", "litro", "HYD-68"],
      [null, "unidad", null],
      [null, "unidad", null],
    ])
  })

  it("un pedido con OT lleva el productId igual (el servidor valida que sea un repuesto activo)", () => {
    const parsed = partsNoteSchema.parse(partsNoteInput({
      ...base, workOrderId: "ot-1", worksiteId: null,
      lines: [{ description: "Filtro de aceite motor", quantity: 1, partNumber: "1R-0750", charge: "", productId: "p-aceite", unit: "unidad" }],
    }))
    expect(parsed.workOrderId).toBe("ot-1")
    expect(parsed.lines[0]).toMatchObject({ productId: "p-aceite", unitOfMeasure: "unidad" })
  })
})

/**
 * Repuestos del catálogo en el buscador de «Solicitud de repuestos»: qué viaja
 * al cliente, cómo suben los comprados para el equipo del ítem y cómo se rotulan.
 */
import { describe, expect, it } from "vitest"
import type { SparePartListItem } from "@/lib/services/spare-parts-catalog"
import {
  buildSparePartOptions, prefillPriceForPart, sparePartDetail, sparePartFacts, sparePartMatchForVehicle,
  sparePartPickerOptions, toSparePartOption,
} from "./spare-part-options"
import type { SparePartOption, VehicleOption } from "./request-form.types"

function listItem(over: Partial<SparePartListItem> = {}): SparePartListItem {
  return {
    id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar",
    unitOfMeasure: "unidad", isActive: true, preferredSupplierId: "sup-1", preferredSupplierName: "Repuestos del Sur",
    lastPrice: 35_000, lastPurchasedAt: "2026-10-01T12:00:00.000Z", vehicleCount: 2,
    purchasedForVehicleIds: ["v-1", "v-9"], vehicleMatch: null, ...over,
  }
}

function option(over: Partial<SparePartOption> = {}): SparePartOption {
  return {
    id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar",
    unitOfMeasure: "unidad", lastPrice: 35_000, preferredSupplierId: null, purchasedForVehicleIds: [], ...over,
  }
}

const vehicle = (id: string, brand: string | null, model: string | null): Pick<VehicleOption, "id" | "brand" | "model"> => ({ id, brand, model })
const FLEET = [
  vehicle("v-1", "Scania", "R450"),
  vehicle("v-2", "SCANIA", " r450 "),
  vehicle("v-3", "Volvo", "FH"),
  vehicle("v-4", null, null),
  vehicle("v-5", null, null),
]

describe("toSparePartOption", () => {
  const ctx = { activeSupplierIds: new Set(["sup-1"]), visibleVehicleIds: new Set(["v-1"]) }

  it("lleva sólo los equipos que la persona puede ver", () => {
    expect(toSparePartOption(listItem(), ctx).purchasedForVehicleIds).toEqual(["v-1"])
  })

  it("ofrece el proveedor preferido sólo si sigue activo", () => {
    expect(toSparePartOption(listItem(), ctx).preferredSupplierId).toBe("sup-1")
    expect(toSparePartOption(listItem({ preferredSupplierId: "sup-baja" }), ctx).preferredSupplierId).toBeNull()
    expect(toSparePartOption(listItem({ preferredSupplierId: null }), ctx).preferredSupplierId).toBeNull()
  })

  it("marca inactivo sólo cuando lo está", () => {
    expect(toSparePartOption(listItem(), ctx)).not.toHaveProperty("isInactive")
    expect(toSparePartOption(listItem({ isActive: false }), ctx).isInactive).toBe(true)
  })
})

describe("buildSparePartOptions", () => {
  const ctx = { activeSupplierIds: new Set<string>(), visibleVehicleIds: new Set<string>() }

  it("suma los repuestos que la solicitud referencia aunque estén inactivos, sin duplicar los del catálogo", () => {
    const options = buildSparePartOptions({
      catalog: [listItem()],
      referenced: [
        { id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad", isActive: true },
        { id: "rpt-9", sku: "RPT-009", name: "Retén", partNumber: "RT-9", partBrand: null, unitOfMeasure: "unidad", isActive: false },
      ],
      ...ctx,
    })
    expect(options.map((o) => o.id)).toEqual(["rpt-1", "rpt-9"])
    // El del catálogo conserva su precio; el sólo-referenciado no lo trae.
    expect(options[0]!.lastPrice).toBe(35_000)
    expect(options[1]).toMatchObject({ lastPrice: null, isInactive: true, purchasedForVehicleIds: [], preferredSupplierId: null })
  })
})

describe("sparePartMatchForVehicle", () => {
  it("«vehicle» si se compró para ese equipo", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-1"] }), "v-1", FLEET)).toBe("vehicle")
  })

  it("«model» si se compró para otro de la misma marca y modelo, sin importar mayúsculas ni espacios", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-2"] }), "v-1", FLEET)).toBe("model")
  })

  it("null si se compró para otro modelo, o no se compró para nadie", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-3"] }), "v-1", FLEET)).toBeNull()
    expect(sparePartMatchForVehicle(option(), "v-1", FLEET)).toBeNull()
  })

  it("sin equipo elegido no rotula nada", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-1"] }), "", FLEET)).toBeNull()
  })

  it("dos equipos sin marca ni modelo no son «el mismo modelo»", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-5"] }), "v-4", FLEET)).toBeNull()
  })

  it("un equipo que el catálogo de flota no trae no rompe: sólo cuenta si es el mismo id", () => {
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-x"] }), "v-viejo", FLEET)).toBeNull()
    expect(sparePartMatchForVehicle(option({ purchasedForVehicleIds: ["v-viejo"] }), "v-viejo", FLEET)).toBe("vehicle")
  })
})

describe("sparePartPickerOptions", () => {
  const filtro = option({ id: "a", name: "Filtro de aceite", sku: "RPT-001", purchasedForVehicleIds: ["v-2"] })
  const oring = option({ id: "b", name: "O-ring", sku: "RPT-002", partNumber: null, partBrand: null, lastPrice: null })
  const pastilla = option({ id: "c", name: "Pastilla de freno", sku: "RPT-003", purchasedForVehicleIds: ["v-1"] })
  const viejo = option({ id: "d", name: "Descontinuado", sku: "RPT-004", isInactive: true })
  const catalog = [filtro, oring, pastilla, viejo]

  it("sin equipo conserva el orden del catálogo y excluye los inactivos", () => {
    expect(sparePartPickerOptions(catalog, "", FLEET).map((o) => o.id)).toEqual(["a", "b", "c"])
  })

  it("con equipo: comprados para él, luego mismo modelo, luego el resto, cada grupo en su orden", () => {
    const options = sparePartPickerOptions(catalog, "v-1", FLEET)
    expect(options.map((o) => o.id)).toEqual(["c", "a", "b"])
    expect(options.map((o) => o.badge)).toEqual(["Para este equipo", "Mismo modelo", null])
    // Cada rótulo corto se explica al pasar el puntero.
    expect(options.map((o) => Boolean(o.badgeTitle))).toEqual([true, true, false])
  })

  it("cada repuesto es su propia familia, con segunda línea y textos de búsqueda", () => {
    const [first] = sparePartPickerOptions([filtro], "", FLEET)
    expect(first).toMatchObject({
      id: "a", sku: "RPT-001", name: "Filtro de aceite", familyId: "a", attributes: [],
      detail: "N° 1R-0750 · Caterpillar · $35.000", searchTerms: ["RPT-001", "1R-0750", "Caterpillar"],
    })
  })
})

describe("sparePartDetail", () => {
  it("junta lo que hay y omite lo que no", () => {
    expect(sparePartDetail({ partNumber: "1R-0750", partBrand: "Caterpillar", lastPrice: 35_000 })).toBe("N° 1R-0750 · Caterpillar · $35.000")
    expect(sparePartDetail({ partNumber: "PF-200", partBrand: null, lastPrice: null })).toBe("N° PF-200")
    expect(sparePartDetail({ partNumber: null, partBrand: null, lastPrice: 0 })).toBe("")
  })
})

describe("sparePartFacts", () => {
  it("SKU siempre; N° de parte y marca sólo si existen", () => {
    expect(sparePartFacts(option())).toEqual([
      { label: "SKU", value: "RPT-001" }, { label: "N° de parte", value: "1R-0750" }, { label: "Marca del repuesto", value: "Caterpillar" },
    ])
    expect(sparePartFacts(option({ partNumber: null, partBrand: " " }))).toEqual([{ label: "SKU", value: "RPT-001" }])
  })
})

describe("prefillPriceForPart", () => {
  it("entero en pesos, o nada si no hay un precio útil", () => {
    expect(prefillPriceForPart({ lastPrice: 35_000.6 })).toBe("35001")
    expect(prefillPriceForPart({ lastPrice: 0 })).toBeNull()
    expect(prefillPriceForPart({ lastPrice: null })).toBeNull()
  })
})

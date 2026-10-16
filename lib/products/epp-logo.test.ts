import { describe, expect, it } from "vitest"
import { applyLogoRule, LOGO_ATTRIBUTE_NAME, LOGO_VALUE, requiresLogo, type LogoSeed } from "./epp-logo"

interface Row { id?: string; name: string; type: string; options: string | null; sortOrder?: number }

const seedRow = (seed: LogoSeed): Row => ({ id: "nuevo", ...seed })
const logoRows = (rows: Row[]) => rows.filter((row) => row.name === LOGO_ATTRIBUTE_NAME)

describe("requiresLogo", () => {
  it("exige logo en las prendas de la fase 1", () => {
    for (const name of [
      "Chaleco geólogo Activex gabardina terra bicolor",
      "Chaleco Activex Geólogo Alta Visibilidad 360°",
      "Geólogo Canvas Altavisibilidad / Sup. Gruas",
      "Polera Polo Dryfresh hombre",
      "Camisa Absolute Zero Lightwind H2600",
      "Blusa Absolute Zero Lightwind W2400",
      "Pantalón Lightwind H3200 nylon spandex hombre",
      "Pantalón Slack Cargo gabardina gris/naranjo",
      "Chaqueta Activex micropolar negro manga larga",
      "Primera Capa Activex polyester",
    ]) {
      expect(requiresLogo({ name, isEpp: true }), name).toBe(true)
    }
  })

  it("no exige logo fuera de la fase 1 ni en lo que no es prenda", () => {
    for (const name of [
      "Botín V-Flex V73 Microfiber",
      "Guante Activex Nitrilo Heavy Duty",
      "Casco Activex IV Alpine ABS",
      "Overol Activex Piloto Poplin c/reflectante",
      "JARDINERA TERMICA  L",
      "Buzo Tyvek 500 Xpert TY198S",
      "Traje PU Verde Activex Pantalón",
      "Capa PVC c/cinta reflectante",
      "Coleto Activex Soldador Cuero Tr.",
      "Gorro Legionario Activex",
    ]) {
      expect(requiresLogo({ name, isEpp: true }), name).toBe(false)
    }
  })

  it("sólo aplica a productos EPP", () => {
    expect(requiresLogo({ name: "Polera Polo Dryfresh hombre", isEpp: false })).toBe(false)
  })
})

describe("applyLogoRule", () => {
  const polera = { name: "Polera Polo Dryfresh hombre", isEpp: true }
  const botin = { name: "Botín V-Flex V73 Microfiber", isEpp: true }

  it("agrega Logo a una prenda que no lo tiene, después de los demás atributos", () => {
    const rows = applyLogoRule(polera, [
      { name: "Talla", type: "select", options: '["T/M"]', sortOrder: 0 },
      { name: "Modelo", type: "select", options: '["Dryfresh"]', sortOrder: 2 },
    ], seedRow)

    expect(rows).toHaveLength(3)
    expect(rows[2]).toEqual({ id: "nuevo", name: LOGO_ATTRIBUTE_NAME, type: "select", options: JSON.stringify([LOGO_VALUE]), isRequired: true, sortOrder: 3 })
  })

  it("convierte en el lugar un Modelo «Con logo» heredado, conservando su id", () => {
    for (const legacy of ['["Con logo"]', '["Con logo Chome"]', "Con logo"]) {
      const rows = applyLogoRule(polera, [
        { id: "attr-modelo", name: "Modelo", type: "select", options: legacy, sortOrder: 1 },
      ], seedRow)

      expect(rows, legacy).toEqual([
        { id: "attr-modelo", name: LOGO_ATTRIBUTE_NAME, type: "select", options: JSON.stringify([LOGO_VALUE]), sortOrder: 1 },
      ])
    }
  })

  it("no confunde un Modelo real con el logo", () => {
    const rows = applyLogoRule(polera, [{ name: "Modelo", type: "select", options: '["Dryfresh"]' }], seedRow)
    expect(rows[0]).toMatchObject({ name: "Modelo", options: '["Dryfresh"]' })
    expect(logoRows(rows)).toHaveLength(1)
  })

  it("normaliza un Logo existente y no lo duplica", () => {
    const rows = applyLogoRule(polera, [{ id: "attr-logo", name: "logo", type: "select", options: '["con logo chome"]' }], seedRow)
    expect(rows).toEqual([{ id: "attr-logo", name: LOGO_ATTRIBUTE_NAME, type: "select", options: JSON.stringify([LOGO_VALUE]) }])
  })

  it("con un Logo explícito, deja el Modelo heredado como está en vez de duplicar", () => {
    const rows = applyLogoRule(polera, [
      { id: "attr-modelo", name: "Modelo", type: "select", options: '["Con logo"]' },
      { id: "attr-logo", name: "Logo", type: "select", options: '["Con logo"]' },
    ], seedRow)
    expect(rows.map((row) => row.id)).toEqual(["attr-modelo", "attr-logo"])
    expect(rows[0]!.name).toBe("Modelo")
  })

  it("es idempotente", () => {
    const once = applyLogoRule(polera, [{ name: "Talla", type: "select", options: '["T/M"]' }], seedRow)
    const twice = applyLogoRule(polera, once, seedRow)
    expect(twice).toEqual(once)
  })

  it("no toca un producto que no lleva logo, ni le quita un Logo que ya tenga", () => {
    const rows: Row[] = [
      { id: "attr-modelo", name: "Modelo", type: "select", options: '["Con logo"]' },
      { id: "attr-logo", name: "Logo", type: "select", options: '["Con logo"]' },
    ]
    expect(applyLogoRule(botin, rows, seedRow)).toEqual(rows)
  })
})

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { parseCargoTable } from "@/lib/services/mantencion/parts-notes/import/cargos"
import type { Catalogs } from "@/lib/services/mantencion/parts-notes/import/catalogs"
import { cleanText, compactKey, mapErpStatus, normalizeChargeCode, parseErpDate, rutKey, testNoteReason } from "@/lib/services/mantencion/parts-notes/import/normalize"
import { parseErpFile } from "@/lib/services/mantencion/parts-notes/import/parse"
import { planNotes } from "@/lib/services/mantencion/parts-notes/import/plan"
import { buildReportWorkbook, REPORT_SHEETS } from "@/lib/services/mantencion/parts-notes/import/report"
import { buildResolvers } from "@/lib/services/mantencion/parts-notes/import/resolvers"
import { DEFAULT_EXCLUSION_RULE } from "@/lib/services/mantencion/parts-notes/import/types"

/** Importador de notas de CHOME ERP, sin base: normalización, lectura del archivo, calces y plan. Datos inventados. */

const catalogs: Catalogs = {
  worksites: [{ id: "w-bio", name: "Biodiversa" }, { id: "w-cho", name: "Cholguán" }],
  aliases: [{ worksiteId: "w-cho", aliasKey: "cholguan norte" }],
  users: [
    { id: "u-ana", name: "Ana Prueba", email: "aprueba@chome.test", isActive: true },
    { id: "u-luis-1", name: "Luis Doble", email: "ldoble1@chome.test", isActive: true },
    { id: "u-luis-2", name: "Luis Doble", email: "ldoble2@chome.test", isActive: true },
  ],
  vehicles: [{ id: "v-ka115", code: "KA-115", plate: "BCDF-12" }, { id: "v-gr11", code: "GR-11", plate: "GR-11" }],
  products: [
    { id: "p-filtro", sku: "SKU-1", name: "Filtro de aceite", partNumber: "FA-100", unitOfMeasure: "unidad", isActive: true },
    { id: "p-viejo", sku: "SKU-2", name: "Correa vieja", partNumber: null, unitOfMeasure: "unidad", isActive: false },
    { id: "p-dup-1", sku: "SKU-3", name: "Perno duplicado", partNumber: null, unitOfMeasure: "unidad", isActive: true },
    { id: "p-dup-2", sku: "SKU-4", name: "Perno duplicado", partNumber: null, unitOfMeasure: "unidad", isActive: true },
  ],
  suppliers: [{ id: "s-rep", name: "Repuestos Uno SpA", rut: "76.000.444-4", isActive: true }],
  costCenters: [{ id: "cc-taller-bio", name: "Taller", worksiteId: "w-bio", isActive: true }],
}
const cargos = parseCargoTable({ alias: { TALLER: { centro: "Taller" }, "CR43-51-52": { revisar: true }, "GRUA UNO": { equipo: "ka 115" }, "FANTASMA": { equipo: "ZZ-1" } } })
const resolvers = buildResolvers(catalogs, cargos)

function erpNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, fecha: "2026-05-02T10:15:00", solicitante: "Ana Prueba", usuario: null, faena: "Biodiversa", urgente: false, observacion: null,
    estado: "Enviada", motivo: null, items: [{ articulo: "Filtro de aceite", codigo: null, cargo: "KA 115", cantidad: 2, proveedor: null }],
    ...overrides,
  }
}
const plan = (notes: unknown[]) => {
  const parsed = parseErpFile({ notas: notes })
  return planNotes({ ...parsed, resolvers, existing: new Map(), rule: DEFAULT_EXCLUSION_RULE })
}

describe("normalización", () => {
  it("«KA 115», «KA115» y «ka-115» son el mismo cargo", () => {
    for (const text of ["KA 115", "KA115", "ka-115", " ka_115 "]) expect(normalizeChargeCode(text)).toBe("KA-115")
    expect(compactKey("KA 115")).toBe(compactKey("ka-115"))
    expect(normalizeChargeCode("CR43-51-52")).toBeNull()
    expect(normalizeChargeCode("Taller")).toBeNull()
  })

  it("la fecha sin zona es hora de Chile: invierno -04 y verano -03, y una fecha imposible no pasa", () => {
    expect(parseErpDate("2026-05-02T10:15:00")).toBe("2026-05-02T14:15:00.000Z")
    expect(parseErpDate("2026-01-15 10:00")).toBe("2026-01-15T13:00:00.000Z")
    expect(parseErpDate("2026-05-02")).toBe("2026-05-02T04:00:00.000Z")
    for (const bad of ["2026-13-01T10:00", "2026-02-30T10:00", "2026-05-02T25:00", "2026-05-02T10:15:00Z", "02/05/2026", ""]) expect(parseErpDate(bad)).toBeNull()
  })

  it("estados, RUT y texto", () => {
    expect([mapErpStatus("Enviada"), mapErpStatus("EN ESPERA"), mapErpStatus("en_espera"), mapErpStatus("Cerrada"), mapErpStatus("Anulada")]).toEqual(["enviada", "en_espera", "en_espera", "cerrada", null])
    expect(rutKey("76.000.444-4")).toBe("760004444")
    expect(rutKey("12345")).toBeNull()
    expect(cleanText("  a   b \n")).toBe("a b")
    expect(cleanText("   ")).toBeNull()
  })

  it("nota de prueba: autor de la lista Y texto «test»; ninguno de los dos solo", () => {
    const base = { solicitante: "Admin", usuario: null, observacion: null, items: [{ articulo: "Tuerca", codigo: null, cargo: null, proveedor: null, cantidad: 1 }] }
    expect(testNoteReason({ ...base, observacion: "Nota de TEST" }, DEFAULT_EXCLUSION_RULE)).toMatch(/Admin/)
    expect(testNoteReason({ ...base, items: [{ ...base.items[0]!, articulo: "articulo test" }] }, DEFAULT_EXCLUSION_RULE)).not.toBeNull()
    expect(testNoteReason(base, DEFAULT_EXCLUSION_RULE)).toBeNull()
    expect(testNoteReason({ ...base, solicitante: "Ana Prueba", observacion: "test" }, DEFAULT_EXCLUSION_RULE)).toBeNull()
    expect(testNoteReason({ ...base, solicitante: "Ana", usuario: "admin", observacion: "test" }, DEFAULT_EXCLUSION_RULE)).not.toBeNull()
    expect(testNoteReason({ ...base, observacion: "Contesto el pedido" }, DEFAULT_EXCLUSION_RULE)).toBeNull()
  })
})

describe("lectura del archivo", () => {
  it("una nota mala no tumba las demás; los errores son por línea y en español", () => {
    const parsed = parseErpFile({ notas: [erpNote(), erpNote({ id: 2, fecha: "ayer" }), erpNote({ id: 3, items: [] }), erpNote({ id: 4, items: [{ articulo: "x", cantidad: 0 }] }), { id: "abc" }] })
    expect(parsed.notes.map((note) => note.externalRef)).toEqual(["CHOME-1"])
    expect(parsed.invalid.map((item) => [item.position, item.externalRef])).toEqual([[2, "CHOME-2"], [3, "CHOME-3"], [4, "CHOME-4"], [5, null]])
    expect(parsed.invalid[0]!.errors.join(" ")).toMatch(/fecha/i)
    expect(parsed.invalid[2]!.errors.join(" ")).toMatch(/línea 1, cantidad/)
  })

  it("un id repetido sólo deja pasar la primera; un archivo sin «notas» aborta", () => {
    const parsed = parseErpFile({ notas: [erpNote(), erpNote({ observacion: "otra" })] })
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.invalid[0]!.errors[0]).toMatch(/repetido/)
    expect(() => parseErpFile([])).toThrow(/notas/)
  })

  it("la cantidad acepta coma decimal; la fecha queda en UTC; el texto vacío es nulo", () => {
    const [note] = parseErpFile({ notas: [erpNote({ observacion: "  ", items: [{ articulo: " Cable ", codigo: 4455, cargo: "", cantidad: "2,5", proveedor: null }] })] }).notes
    expect(note).toMatchObject({ createdAt: "2026-05-02T14:15:00.000Z", observacion: null, estado: "enviada" })
    expect(note!.items[0]).toEqual({ articulo: "Cable", codigo: "4455", cargo: null, proveedor: null, cantidad: 2.5 })
  })
})

describe("calces", () => {
  it("cargo: equipo suelto, alias a equipo, alias a centro de la faena, «revisar» y sin calce", () => {
    expect(resolvers.charge("ka115", "w-bio")).toMatchObject({ kind: "vehicle", vehicleId: "v-ka115", label: "KA-115" })
    expect(resolvers.charge("bcdf 12", "w-bio")).toMatchObject({ kind: "vehicle", vehicleId: "v-ka115" })
    expect(resolvers.charge("Grua Uno", "w-bio")).toMatchObject({ kind: "vehicle", vehicleId: "v-ka115" })
    expect(resolvers.charge("taller", "w-bio")).toMatchObject({ kind: "costCenter", costCenterId: "cc-taller-bio" })
    expect(resolvers.charge("taller", "w-cho")).toMatchObject({ kind: "pending", reason: expect.stringMatching(/centro «Taller»/) })
    expect(resolvers.charge("CR43 51 52", "w-bio")).toMatchObject({ kind: "pending", chargeText: "CR43 51 52", reason: expect.stringMatching(/revisar/) })
    expect(resolvers.charge("fantasma", "w-bio")).toMatchObject({ kind: "pending", reason: expect.stringMatching(/ZZ-1/) })
    expect(resolvers.charge("XY 999", "w-bio")).toMatchObject({ kind: "pending", chargeText: "XY 999" })
    expect(resolvers.charge("  ", "w-bio")).toEqual({ kind: "none" })
  })

  it("artículo: por código y por nombre, sólo repuestos activos y nunca uno ambiguo", () => {
    expect(resolvers.product("Lo que sea", "fa 100")).toEqual({ id: "p-filtro", unitOfMeasure: "unidad" })
    expect(resolvers.product("filtro DE aceite", null)).toMatchObject({ id: "p-filtro" })
    expect(resolvers.product("Correa vieja", null)).toBeNull()
    expect(resolvers.product("Perno duplicado", null)).toBeNull()
    expect(resolvers.product("Algo inexistente", "NO-EXISTE")).toBeNull()
  })

  it("proveedor por RUT o por nombre; solicitante por login, correo o nombre, y nunca uno ambiguo", () => {
    expect(resolvers.supplierId("76000444-4")).toBe("s-rep")
    expect(resolvers.supplierId("REPUESTOS UNO spa")).toBe("s-rep")
    expect(resolvers.supplierId("Otro proveedor")).toBeNull()
    expect(resolvers.userId("aprueba", null)).toBe("u-ana")
    expect(resolvers.userId(null, "ana prueba")).toBe("u-ana")
    expect(resolvers.userId("APRUEBA@chome.test", null)).toBe("u-ana")
    expect(resolvers.userId(null, "Luis Doble")).toBeNull()
    expect(resolvers.userId("ldoble2", "Luis Doble")).toBe("u-luis-2")
  })

  it("faena por nombre sin tildes y por alias; una faena desconocida no calza", () => {
    expect(resolvers.worksiteId("CHOLGUAN")).toBe("w-cho")
    expect(resolvers.worksiteId("cholguan norte")).toBe("w-cho")
    expect(resolvers.worksiteId("Pacífico")).toBeNull()
  })

  it("una tabla de cargos con un alias de dos equivalencias o una forma rara es un error", () => {
    expect(() => parseCargoTable({ alias: { "KA 1": { equipo: "KA-1" }, "ka-1": { centro: "Taller" } } })).toThrow(/repite/)
    expect(() => parseCargoTable({ alias: { X: { equipo: "A", centro: "B" } } })).toThrow(/tabla de cargos/)
    expect(() => parseCargoTable({ alias: { X: { revisar: false } } })).toThrow(/tabla de cargos/)
    expect(parseCargoTable({ _ayuda: "texto", alias: {} }).size).toBe(0)
  })
})

describe("archivos que se entregan", () => {
  const read = (file: string) => JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8")) as unknown

  it("el ejemplo inventado se lee, cubre los cinco estados y trae una nota inválida a propósito; la tabla de cargos es válida", () => {
    const parsed = parseErpFile(read("scripts/data/chome-erp-notas.ejemplo.json"))
    expect([...new Set(parsed.notes.map((note) => note.estado))].sort()).toEqual(["aceptada", "cerrada", "en_espera", "enviada", "rechazada"])
    expect(parsed.invalid.map((item) => item.externalRef)).toEqual(["CHOME-90008"])
    expect(parseCargoTable(read("scripts/data/chome-erp-cargos.json")).size).toBeGreaterThan(0)
  })
})

describe("plan", () => {
  it("separa lo que se importa, lo de prueba, lo sin faena y lo inválido; la nota importable respeta su estado", () => {
    const result = plan([
      erpNote({ id: 10, estado: "Cerrada" }),
      erpNote({ id: 11, solicitante: "Admin", observacion: "test de envío" }),
      erpNote({ id: 12, faena: "Isla Desconocida" }),
      erpNote({ id: 13, fecha: "nunca" }),
      erpNote({ id: 14, estado: "Rechazada", motivo: "Dup" }),
      erpNote({ id: 16, estado: "Rechazada", motivo: "Duplicada del pedido 10" }),
      erpNote({ id: 15, estado: "En espera", motivo: "no" }),
    ])
    expect(result.toImport.map((note) => [note.externalRef, note.status])).toEqual([["CHOME-10", "cerrada"], ["CHOME-14", "rechazada"], ["CHOME-15", "en_espera"], ["CHOME-16", "rechazada"]])
    expect(result.excluded.map((item) => item.externalRef)).toEqual(["CHOME-11"])
    expect(result.worksiteUnmatched).toMatchObject([{ faena: "Isla Desconocida", notes: 1, lines: 1 }])
    expect(result.invalid.map((item) => item.externalRef)).toEqual(["CHOME-13"])
    const [closed, rejected, held, rejectedLong] = result.toImport
    expect(closed!.lines[0]).toMatchObject({ resolution: "en_compra", chargeVehicleId: "v-ka115", productId: "p-filtro" })
    expect(rejected!.lines[0]).toMatchObject({ resolution: "rechazada", resolutionReason: "Rechazada en CHOME ERP" })
    expect(rejected!.notes).toBe("Motivo en CHOME ERP: Dup")
    expect(rejectedLong!.lines[0]).toMatchObject({ resolution: "rechazada", resolutionReason: "Duplicada del pedido 10" })
    expect(rejectedLong!.notes).toBeNull()
    expect(held).toMatchObject({ holdReason: "Migrada desde CHOME ERP", notes: "Motivo en CHOME ERP: no" })
    expect(held!.lines[0]).toMatchObject({ resolution: "pendiente", resolutionReason: null })
  })

  it("lo que no calza queda en los informes con frecuencia y la línea conserva el texto original", () => {
    const result = plan([
      erpNote({ id: 20, items: [
        { articulo: "Rodamiento 6205", codigo: null, cargo: "CR43-51-52", cantidad: 2, proveedor: "Proveedor Nuevo" },
        { articulo: "Filtro de aceite", codigo: null, cargo: "TALLER", cantidad: 1, proveedor: "Repuestos Uno SpA" },
      ] }),
      erpNote({ id: 21, items: [{ articulo: "RODAMIENTO 6205", codigo: null, cargo: null, cantidad: 3, proveedor: "proveedor nuevo" }] }),
    ])
    expect(result.articlesWithoutMatch).toEqual([{ articulo: "Rodamiento 6205", codigo: null, lines: 2, quantity: 5, notes: 2 }])
    expect(result.suppliersWithoutMatch).toEqual([{ proveedor: "Proveedor Nuevo", lines: 2, notes: 2 }])
    expect(result.pendingCharges).toMatchObject([{ externalRef: "CHOME-20", cargo: "CR43-51-52", articulo: "Rodamiento 6205" }])
    const [first] = result.toImport
    expect(first!.lines[0]).toMatchObject({ description: "Rodamiento 6205", productId: null, chargeText: "CR43-51-52", supplierHint: "Proveedor Nuevo", suggestedSupplierId: null, unitOfMeasure: "unidad" })
    expect(first!.lines[1]).toMatchObject({ productId: "p-filtro", chargeCostCenterId: "cc-taller-bio", suggestedSupplierId: "s-rep", supplierHint: null })
  })

  it("el folio sigue el orden de las fechas y toma el año de la fecha en hora de Chile", () => {
    const result = plan([
      erpNote({ id: 31, fecha: "2026-12-31T22:30:00" }),
      erpNote({ id: 30, fecha: "2025-12-31T23:59:00" }),
      erpNote({ id: 32, fecha: "2026-01-01T00:10:00" }),
    ])
    expect(result.toImport.map((note) => [note.erpId, note.folioYear])).toEqual([["30", 2025], ["32", 2026], ["31", 2026]])
  })

  it("las que ya existen se saltan y se informan con su folio; una línea que se redondea a cero deja la nota inválida", () => {
    const parsed = parseErpFile({ notas: [erpNote({ id: 40 }), erpNote({ id: 41, items: [{ articulo: "Polvo", cantidad: 0.001 }] })] })
    const result = planNotes({ ...parsed, resolvers, rule: DEFAULT_EXCLUSION_RULE, existing: new Map([["CHOME-40", { externalRef: "CHOME-40", code: "NP-2026-0007", status: "aceptada" }]]) })
    expect(result.alreadyImported).toMatchObject([{ externalRef: "CHOME-40", code: "NP-2026-0007", status: "aceptada" }])
    expect(result.toImport).toHaveLength(0)
    expect(result.invalid).toMatchObject([{ externalRef: "CHOME-41", position: null, errors: [expect.stringMatching(/redondea a cero/)] }])
  })

  it("un artículo o una observación largos se recortan con aviso; la nota entra", () => {
    const result = plan([erpNote({ id: 50, observacion: "o".repeat(600), items: [{ articulo: "a".repeat(350), cantidad: 1 }] })])
    const [note] = result.toImport
    expect(note!.lines[0]!.description).toHaveLength(300)
    expect(note!.notes).toHaveLength(500)
    expect(note!.warnings).toHaveLength(2)
  })

  it("el informe Excel trae las hojas pedidas", async () => {
    const result = plan([erpNote({ id: 60 }), erpNote({ id: 61, faena: "Isla" })])
    const workbook = buildReportWorkbook({ fileName: "notas.json", plan: result, applied: null })
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(Object.values(REPORT_SHEETS))
    expect(workbook.getWorksheet(REPORT_SHEETS.worksites)!.rowCount).toBe(2)
    expect(workbook.getWorksheet(REPORT_SHEETS.summary)!.getCell("B2").value).toMatch(/SIMULACIÓN/)
  })
})

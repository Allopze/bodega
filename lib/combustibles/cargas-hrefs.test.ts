import { describe, expect, it } from "vitest"
import { buildCargaRowHrefs } from "./cargas-hrefs"
import { inboxRowKey } from "./inbox/types"
import { fuelInboxHref, withFuelContext } from "./routes"

type RowInput = Parameters<typeof buildCargaRowHrefs>[0]

const TAE: RowInput = {
  source: "tae_pwa", id: "tae-1", detailId: "tae-1", vehicleId: "veh-1",
  evidenceCount: 4, reviewFlagged: null, equipmentLoadId: "el-1",
}
const INVOICE: RowInput = {
  source: "invoiced", id: "inv-1", detailId: "inv-1", vehicleId: null,
  evidenceCount: null, reviewFlagged: null, equipmentLoadId: null,
}
const PLANILLA: RowInput = {
  source: "operation_manual", id: "op-1", detailId: "op-1", vehicleId: "veh-2",
  evidenceCount: null, reviewFlagged: true, equipmentLoadId: "el-9",
}

/** El período y la faena de la pantalla, que la página agrega a cada destino con `withFuelContext`. */
const SCREEN = { periodo: "2026-10", faena: "w-1" }
const context = (href: string) => withFuelContext(href, SCREEN)
const ALL = { canViewAudit: true, canViewPersonal: true, context }

describe("buildCargaRowHrefs: los enlaces de una fila de Cargas", () => {
  it("la insignia «Caso abierto» lleva a los casos de ESA carga, con la fuente y el id", () => {
    expect(buildCargaRowHrefs(TAE, ALL).cases).toBe("/combustibles/revisar?tipo=caso&ref=tae_pwa%3Atae-1&periodo=2026-10&faena=w-1")
    expect(buildCargaRowHrefs(INVOICE, ALL).cases).toBe("/combustibles/revisar?tipo=caso&ref=invoiced%3Ainv-1&periodo=2026-10&faena=w-1")
    expect(buildCargaRowHrefs(PLANILLA, ALL).cases).toBe("/combustibles/revisar?tipo=caso&ref=operation_manual%3Aop-1&periodo=2026-10&faena=w-1")
  })

  it("el `ref` se arma con la identidad de la fila (`id`), no con el id de su ficha", () => {
    const href = buildCargaRowHrefs({ ...TAE, id: "fila", detailId: "ficha" }, ALL).cases
    expect(new URL(href, "http://localhost").searchParams.get("ref")).toBe("tae_pwa:fila")
  })

  it("cargas distintas llevan a casos distintos (antes todas llevaban a la lista completa)", () => {
    const refs = [TAE, INVOICE, PLANILLA].map((row) => new URL(buildCargaRowHrefs(row, ALL).cases, "http://localhost").searchParams.get("ref"))
    expect(new Set(refs).size).toBe(3)
    expect(buildCargaRowHrefs(TAE, ALL).cases).not.toBe(context(fuelInboxHref({ tipo: "caso" })))
  })

  it("un id con caracteres especiales viaja codificado y se lee de vuelta entero", () => {
    const href = buildCargaRowHrefs({ ...INVOICE, id: "a:b&c d" }, ALL).cases
    expect(href).not.toContain("&c d")
    expect(new URL(href, "http://localhost").searchParams.get("ref")).toBe("invoiced:a:b&c d")
  })

  it("la ficha, el equipo y el historial de un registro en terreno quedan como antes", () => {
    const hrefs = buildCargaRowHrefs(TAE, ALL)
    expect(hrefs.detail).toBe("/combustibles/cargas/terreno/tae-1?periodo=2026-10&faena=w-1")
    expect(hrefs.equipment).toBe("/combustibles/consumo/equipos/veh-1?periodo=2026-10&faena=w-1")
    expect(hrefs.history).toBe("/combustibles/cargas/terreno/tae-1/historial?periodo=2026-10&faena=w-1")
  })

  it("cada fuente abre su propia ficha e historial", () => {
    expect(buildCargaRowHrefs(INVOICE, ALL).detail).toBe("/combustibles/cargas/factura/inv-1?periodo=2026-10&faena=w-1")
    expect(buildCargaRowHrefs(INVOICE, ALL).history).toBe("/combustibles/cargas/factura/inv-1/historial?periodo=2026-10&faena=w-1")
    expect(buildCargaRowHrefs(PLANILLA, ALL).detail).toBe("/combustibles/cargas/planilla/op-1?periodo=2026-10&faena=w-1")
    expect(buildCargaRowHrefs(PLANILLA, ALL).history).toBe("/combustibles/cargas/planilla/op-1/historial?periodo=2026-10&faena=w-1")
  })

  it("sin equipo vinculado no hay enlace al equipo", () => {
    expect(buildCargaRowHrefs(INVOICE, ALL).equipment).toBeNull()
  })

  it("el historial sólo existe con `view_audit`", () => {
    expect(buildCargaRowHrefs(TAE, { ...ALL, canViewAudit: false }).history).toBeNull()
    expect(buildCargaRowHrefs(TAE, { ...ALL, canViewAudit: true }).history).not.toBeNull()
  })

  it("las fotos son un ancla de la ficha y sólo con `view_personal`, de un registro en terreno con fotos", () => {
    expect(buildCargaRowHrefs(TAE, ALL).evidence).toBe("/combustibles/cargas/terreno/tae-1?periodo=2026-10&faena=w-1#evidencia")
    expect(buildCargaRowHrefs(TAE, { ...ALL, canViewPersonal: false }).evidence).toBeNull()
    expect(buildCargaRowHrefs({ ...TAE, evidenceCount: 0 }, ALL).evidence).toBeNull()
    expect(buildCargaRowHrefs({ ...TAE, evidenceCount: null }, ALL).evidence).toBeNull()
    // Una factura o una fila de planilla no tienen fotos, aunque la consulta trajera un conteo.
    expect(buildCargaRowHrefs({ ...INVOICE, evidenceCount: 3 }, ALL).evidence).toBeNull()
    expect(buildCargaRowHrefs({ ...PLANILLA, evidenceCount: 3 }, ALL).evidence).toBeNull()
  })

  it("«por decidir» lleva a la carga en la bandeja, y sólo si la plataforma la dejó por decidir y tiene fila proyectada", () => {
    expect(buildCargaRowHrefs(PLANILLA, ALL).decide).toBe(`${fuelInboxHref({ tipo: "carga", item: inboxRowKey("carga", "el-9") })}&periodo=2026-10&faena=w-1`)
    expect(buildCargaRowHrefs(TAE, ALL).decide).toBeNull()
    expect(buildCargaRowHrefs({ ...PLANILLA, equipmentLoadId: null }, ALL).decide).toBeNull()
    expect(buildCargaRowHrefs({ ...PLANILLA, reviewFlagged: false }, ALL).decide).toBeNull()
  })

  it("el pedido de revisión sigue llevando a los pedidos de la bandeja", () => {
    expect(buildCargaRowHrefs(TAE, ALL).requested).toBe("/combustibles/revisar?tipo=pedido&periodo=2026-10&faena=w-1")
  })

  it("sin período ni faena en la pantalla, los enlaces salen sin ellos", () => {
    const bare = { ...ALL, context: (href: string) => withFuelContext(href, {}) }
    expect(buildCargaRowHrefs(TAE, bare).cases).toBe("/combustibles/revisar?tipo=caso&ref=tae_pwa%3Atae-1")
    expect(buildCargaRowHrefs(TAE, bare).detail).toBe("/combustibles/cargas/terreno/tae-1")
  })
})

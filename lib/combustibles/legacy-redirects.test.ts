import { describe, expect, it } from "vitest"
import { legacyFuelRedirect, legacyPanelRedirect, type LegacyFuelRoute } from "./legacy-redirects"

type Row = [LegacyFuelRoute, Record<string, string>, Record<string, string>, string]

const ROWS: Row[] = [
  ["analisis", {}, { preset: "heavy", faena: "ws1", desde: "2026-10-01", hasta: "2026-10-15" }, "/combustibles/consumo/rendimiento/maquinaria?faena=ws1&desde=2026-10-01&hasta=2026-10-15"],
  ["analisis", {}, {}, "/combustibles/consumo/rendimiento/camiones"],
  ["reportes", {}, { desde: "2026-09-01", hasta: "2026-09-30" }, "/combustibles/consumo/litros?seccion=tarjetas&desde=2026-09-01&hasta=2026-09-30"],
  ["revision", {}, { faena: "ws1" }, "/combustibles/revisar?faena=ws1"],
  ["anomalias", {}, { estado: "vigentes", severidad: "high", page: "2" }, "/combustibles/revisar?tipo=caso&severidad=high&pagina=2"],
  ["anomalias", {}, { estado: "dismissed", ref: "tae_pwa:t1" }, "/combustibles/revisar?tipo=caso&vista=decididas&ref=tae_pwa%3At1"],
  ["anomalias-reglas", {}, {}, "/combustibles/ajustes/reglas"],
  ["bitacora", {}, { fuente: "tae_pwa", q: "CA-14", desde: "2026-10-01", hasta: "2026-10-31" }, "/combustibles/cargas?q=CA-14&como=qr%2Capp%2Chistorico&desde=2026-10-01&hasta=2026-10-31"],
  ["bitacora", {}, { fuente: "operation_manual" }, "/combustibles/cargas?como=planilla"],
  ["bitacora-historial", { entityType: "fuel_load", entityId: "l1" }, {}, "/combustibles/cargas/factura/l1/historial"],
  ["bitacora-historial", { entityType: "otro", entityId: "x" }, {}, "/combustibles/cargas"],
  ["ciclo", {}, { faena: "ws1", etapa: "consumed", desde: "2026-10-01", hasta: "2026-10-30" }, "/combustibles/cuadratura/estanques?faena=ws1&desde=2026-10-01&hasta=2026-10-30"],
  ["control", {}, { anio: "2026", meses: "10", faena: "ws1" }, "/combustibles/consumo/litros?faena=ws1&periodo=2026-10"],
  ["control-rendimiento", { familia: "cargadores-camionetas" }, { anio: "2026", unidad: "km_per_liter" }, "/combustibles/consumo/rendimiento/cargadores-camionetas?unidad=km_per_liter&periodo=2026"],
  ["control-ralenti", {}, { anio: "2026", meses: "7,8,9", equipo: "v1" }, "/combustibles/consumo/motor-en-vacio?equipo=v1&periodo=2026-T3"],
  ["control-registrar", {}, { faena: "ws1", lugar: "p1" }, "/combustibles/cargas/registrar?faena=ws1&punto=p1"],
  ["control-revision", {}, { estado: "aprobadas", anio: "2026" }, "/combustibles/revisar?tipo=carga&vista=decididas&decision=cuenta&periodo=2026"],
  ["control-revision", {}, { estado: "rechazadas" }, "/combustibles/revisar?tipo=carga&vista=decididas&decision=no-cuenta"],
  ["control-sellos", {}, { mandante: "m1" }, "/combustibles/cuadratura/mandante?mandante=m1"],
  ["control-importar", {}, {}, "/combustibles/fuentes?agregar=telemetria"],
  ["control-configuracion", {}, {}, "/combustibles/ajustes/mandantes"],
  ["cuenta-corriente", {}, { month: "2026-09" }, "/combustibles/pagos/estados?periodo=2026-09"],
  ["cuenta-corriente-detalle", { id: "st-1" }, {}, "/combustibles/pagos/estados/st-1"],
  ["facturas", {}, { month: "2026-10", status: "draft" }, "/combustibles/pagos?status=draft&periodo=2026-10"],
  ["facturas", {}, { startDate: "2026-10-01", endDate: "2026-10-15" }, "/combustibles/pagos?desde=2026-10-01&hasta=2026-10-15"],
  ["factura-detalle", { id: "fl-1" }, {}, "/combustibles/cargas/factura/fl-1"],
  ["nueva", {}, {}, "/combustibles/pagos/nueva"],
  ["importar", {}, { tab: "operaciones" }, "/combustibles/fuentes/agregar/planilla"],
  ["importar", {}, {}, "/combustibles/fuentes"],
  ["importar-detalle", { id: "b1" }, {}, "/combustibles/fuentes/archivos/tarjeta/b1"],
  ["importar-operaciones-detalle", { id: "b2" }, {}, "/combustibles/fuentes/archivos/planilla/b2"],
  ["sellos", {}, { patente: "KPRT14" }, "/combustibles/cuadratura/sellos?vista=historial&patente=KPRT14"],
  ["tae", {}, { estado: "submitted", from: "2026-10-01", to: "2026-10-30" }, "/combustibles/cargas?como=qr%2Capp%2Chistorico&estado=por-validar&desde=2026-10-01&hasta=2026-10-30"],
  ["tae-detalle", { id: "t1" }, {}, "/combustibles/cargas/terreno/t1"],
  ["tae-conciliacion", {}, { faena: "ws1", desde: "2026-10-01", hasta: "2026-10-31" }, "/combustibles/cuadratura/tarjeta-y-terreno?faena=ws1&desde=2026-10-01&hasta=2026-10-31"],
  ["tae-importar", {}, {}, "/combustibles/fuentes/agregar/sellos"],
  ["tae-importar-detalle", { id: "tb1" }, {}, "/combustibles/fuentes/archivos/sellos/tb1"],
  ["tae-importar-historial", {}, {}, "/combustibles/fuentes/archivos?tipo=sellos"],
]

describe("legacyFuelRedirect", () => {
  it.each(ROWS)("%s %j %j → %s", (route, params, sp, expected) => {
    expect(legacyFuelRedirect(route, params, sp)).toBe(expected)
  })

  it("todas las rutas antiguas tienen al menos una fila", () => {
    const covered = new Set(ROWS.map((row) => row[0]))
    const all: LegacyFuelRoute[] = [
      "analisis", "reportes", "revision", "anomalias", "anomalias-reglas", "bitacora", "bitacora-historial", "ciclo", "control",
      "control-rendimiento", "control-ralenti", "control-registrar", "control-revision", "control-sellos", "control-importar",
      "control-configuracion", "cuenta-corriente", "cuenta-corriente-detalle", "facturas", "factura-detalle", "nueva", "importar",
      "importar-detalle", "importar-operaciones-detalle", "sellos", "tae", "tae-detalle", "tae-conciliacion", "tae-importar",
      "tae-importar-detalle", "tae-importar-historial",
    ]
    expect(all.filter((route) => !covered.has(route))).toEqual([])
  })
})

describe("legacyPanelRedirect", () => {
  it("una visita al Panel no redirige", () => {
    expect(legacyPanelRedirect({})).toBeNull()
    expect(legacyPanelRedirect({ periodo: "2026-10", faena: "ws1" })).toBeNull()
  })

  it("los registros de tarjeta van a Cargas › Tarjetas", () => {
    expect(legacyPanelRedirect({ vista: "registros", asociacion: "no", page: "3" })).toBe("/combustibles/cargas/tarjetas?sin_vincular=si&pagina=3")
  })

  it("el análisis por tarjeta y los filtros de patente van a Consumo › Litros", () => {
    expect(legacyPanelRedirect({ vista: "analisis", desde: "2026-10-01", hasta: "2026-10-30" }))
      .toBe("/combustibles/consumo/litros?seccion=tarjetas&desde=2026-10-01&hasta=2026-10-30")
    expect(legacyPanelRedirect({ patente: "KPRT14" })).toBe("/combustibles/consumo/litros?seccion=tarjetas&patente=KPRT14")
  })
})

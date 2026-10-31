import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { FuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import type { EquipmentFileLoad } from "@/lib/combustibles/equipment/types"
import type { WatchItem } from "@/lib/combustibles/consumption-watch"
import { ConsumptionWatchList } from "../consumption-alerts"
import { FuelOriginSummary } from "../fuel-control-overview"
import { UrlFold } from "./_components/url-fold"
import { EquipmentLoadsTable } from "./equipos/[id]/equipment-loads-table"

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

const html = (node: React.ReactElement) => renderToStaticMarkup(node)

describe("bloque plegable por URL", () => {
  it("cerrado es una fila con su enlace «Ver» y no trae el contenido", () => {
    const out = html(<UrlFold id="tarjetas" title="Más análisis de tarjetas" description="…" open={false} openHref="?seccion=tarjetas" closeHref="?">CONTENIDO PESADO</UrlFold>)
    expect(out).toContain('href="?seccion=tarjetas"')
    expect(out).toContain(">Ver<")
    expect(out).not.toContain("CONTENIDO PESADO")
  })

  it("abierto trae el contenido y el enlace «Ocultar» vuelve a cerrarlo", () => {
    const out = html(<UrlFold id="tarjetas" title="Más análisis de tarjetas" description="…" open openHref="?seccion=tarjetas" closeHref="?periodo=2026-10">CONTENIDO PESADO</UrlFold>)
    expect(out).toContain("CONTENIDO PESADO")
    expect(out).toContain(">Ocultar<")
    expect(out).toContain('href="?periodo=2026-10"')
  })
})

describe("patentes para mirar", () => {
  const item = (overrides: Partial<WatchItem>): WatchItem => ({ key: "k", label: "KA-01 (AB1234)", reason: "Consumió 1.840 L", action: "Revisar", severity: "medium", href: "/combustibles/consumo/equipos/v1", hrefLabel: "Abrir la ficha del equipo", ...overrides })

  it("cada alerta con destino es un enlace, con el texto de adónde lleva", () => {
    const out = html(<ConsumptionWatchList items={[item({})]} />)
    expect(out).toContain('href="/combustibles/consumo/equipos/v1"')
    expect(out).toContain("Abrir la ficha del equipo")
    expect(out).toContain("KA-01 (AB1234)")
  })

  it("una alerta sin destino no es un enlace", () => {
    const out = html(<ConsumptionWatchList items={[item({ href: null, hrefLabel: null, label: "Gasto total" })]} />)
    expect(out).not.toContain("<a ")
    expect(out).toContain("Gasto total")
  })

  it("sin alertas lo dice en palabras", () => {
    expect(html(<ConsumptionWatchList items={[]} />)).toContain("Ninguna patente se sale de lo habitual")
  })
})

describe("de dónde vino lo cargado", () => {
  const data: FuelControlOverview = {
    billed: { liters: 38620, amount: 58_400_000, records: 38, variationLitersPct: -4 },
    tae: { liters: 30120, loads: 412, equipment: 104, pendingReview: 0, observed: 0, missingSeals: 0, missingEvidence: 0, variationLitersPct: 2 },
    byWorksite: [{ worksiteId: "w1", worksiteName: "Faena Uno", billedLiters: 100, taeLiters: 200, tctLiters: 300 }],
  }
  const props = {
    data,
    canViewCosts: true,
    tct: { liters: 28120, transactions: 900, vehicles: 61, cards: 70, variationLitersPct: -6 },
    hrefs: { terreno: "/combustibles/cargas?periodo=2026-10", tarjetas: "/combustibles/cargas/tarjetas?periodo=2026-10", facturas: "/combustibles/pagos?periodo=2026-10", cuadratura: "/combustibles/cuadratura?periodo=2026-10" },
    worksiteHref: (id: string) => `?faena=${id}`,
  }

  it("usa el vocabulario nuevo, dice que los orígenes no se suman y enlaza cada cifra a su detalle", () => {
    const out = html(<FuelOriginSummary {...props} />)
    expect(out).toContain("Registrado en terreno")
    expect(out).toContain("Informado por tarjetas")
    expect(out).toContain("Facturado")
    expect(out).toContain("No se suman")
    expect(out).not.toMatch(/TAE|TCT/)
    expect(out).toContain('href="/combustibles/cargas?periodo=2026-10"')
    expect(out).toContain('href="/combustibles/pagos?periodo=2026-10"')
    expect(out).toContain("Ver la cuadratura")
  })

  it("un clic en una faena filtra esa faena", () => {
    expect(html(<FuelOriginSummary {...props} />)).toContain('href="?faena=w1"')
  })

  it("sin permiso de costos no hay monto ni enlace a Pagos", () => {
    const out = html(<FuelOriginSummary {...props} canViewCosts={false} hrefs={{ ...props.hrefs, facturas: null }} />)
    expect(out).not.toContain("58.400.000")
    expect(out).not.toContain("/combustibles/pagos")
  })

  it("sin permiso de terreno no inventa la cifra ni su barra", () => {
    const out = html(<FuelOriginSummary {...props} data={{ ...data, tae: null }} hrefs={{ ...props.hrefs, cuadratura: null }} />)
    expect(out).toContain("Sin acceso")
    expect(out).not.toContain("Ver la cuadratura")
    expect(out).not.toContain(">Terreno<")
  })

  it("sin actividad dice qué significa y ofrece la acción", () => {
    const out = html(<FuelOriginSummary {...props} data={{ ...data, byWorksite: [] }} emptyAction={<button type="button">Agregar datos</button>} />)
    expect(out).toContain("Sin actividad en el período")
    expect(out).toContain("Agregar datos")
  })

  it("avisa cuando las tarjetas informan por mes completo", () => {
    expect(html(<FuelOriginSummary {...props} tctNote="Las tarjetas informan un total por mes" />)).toContain("Las tarjetas informan un total por mes")
  })
})

describe("últimas cargas del equipo", () => {
  const load = (overrides: Partial<EquipmentFileLoad>): EquipmentFileLoad => ({
    id: "l1", occurredAt: "2026-10-30T12:12:00Z", liters: 185, meterType: "odometer", meterReading: 182310, performanceValue: null, performanceNote: "Lectura menor a la anterior",
    originLabel: "Registrada en la app", stateLabel: "Por validar", reviewStatus: "flagged", href: "/combustibles/cargas/terreno/s1", ...overrides,
  })

  it("una carga sin rendimiento dice por qué, y una por decidir se ve con su estado", () => {
    const out = html(<EquipmentLoadsTable rows={[load({})]} unit="km_per_liter" />)
    expect(out).toContain("Lectura menor a la anterior")
    expect(out).toContain("Por decidir")
    expect(out).toContain("Por validar")
    expect(out).toContain("182.310 km")
    expect(out).toContain('href="/combustibles/cargas/terreno/s1"')
    expect(out).not.toContain("flagged")
  })

  it("con rendimiento calculado muestra el valor con su unidad", () => {
    const out = html(<EquipmentLoadsTable rows={[load({ performanceValue: 2.1, performanceNote: null, reviewStatus: "ok" })]} unit="km_per_liter" />)
    expect(out).toContain("2,1")
    expect(out).toContain("km/L")
    expect(out).not.toContain("Por decidir")
  })

  it("una fila de la planilla no inventa un estado", () => {
    const out = html(<EquipmentLoadsTable rows={[load({ stateLabel: null, reviewStatus: "ok", originLabel: "Planilla de cargas", href: null })]} unit={null} />)
    expect(out).toContain("Planilla de cargas")
    expect(out).not.toContain("<a ")
  })

  it("sin cargas explica qué hacer", () => {
    expect(html(<EquipmentLoadsTable rows={[]} unit={null} />)).toContain("Sin cargas en este período")
  })
})

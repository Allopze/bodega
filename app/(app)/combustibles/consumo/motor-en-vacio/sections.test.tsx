import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { IdleEquipmentMonthRow, IdleStats } from "@/lib/combustibles/control/queries/idle"
import { resolvePagination } from "@/lib/pagination"
import { LitersPerHourSection, LitersPerHourTable, TopIdleDaysTable } from "./comparison-sections"
import { EquipmentMonthTable } from "./equipment-month-table"
import { IdleTopEquipmentTable } from "./top-equipment-table"

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
// Recharts sólo corre en el navegador: acá importa lo que la sección dice alrededor del gráfico.
vi.mock("../../control/_charts/idle-charts-lazy", () => ({ LphScatterChartLazy: ({ view }: { view: { points: unknown[] } }) => <div data-testid="lph-chart">{view.points.length} puntos</div> }))

const stats: IdleStats = {
  operatingHours: 100, idleHours: 25, workingHours: 75, activeDays: 10, idlePct: 25, dailyAvgPct: 24, dailyMaxPct: 60, dailyMinPct: 5,
  avgWorkingPerDay: 7.5, avgIdlePerDay: 2.5, litersWorking: 800, litersIdle: null,
}
const row: IdleEquipmentMonthRow = { ...stats, vehicleId: "v1", equipment: "KA-1 · AA-0001", month: "2026-03" }

describe("EquipmentMonthTable", () => {
  it("muestra % recalculado, litros ausentes como guion y la fila de total general", () => {
    const pagination = resolvePagination({ pageParam: "1", totalItems: 1, pageSize: 50 })
    const html = renderToStaticMarkup(<EquipmentMonthTable rows={[row]} total={stats} pagination={pagination} hrefForPage={() => "?"} />)
    expect(html).toContain("KA-1 · AA-0001")
    expect(html).toContain("Mar 2026")
    expect(html).toContain("25 %")
    expect(html).toContain("Total general")
    expect(html).toContain("800 L")
    expect(html).toContain("—")
    expect(html).toContain('title="Horas en vacío ÷ horas de funcionamiento del mes"')
  })

  it("sin telemetría en el período explica qué hacer", () => {
    const pagination = resolvePagination({ pageParam: "1", totalItems: 0, pageSize: 50 })
    expect(renderToStaticMarkup(<EquipmentMonthTable rows={[]} total={null} pagination={pagination} hrefForPage={() => "?"} />)).toContain("agrega la telemetría de los equipos")
  })
})

describe("LitersPerHourTable y TopIdleDaysTable", () => {
  it("un mes sin cargas dice «Sin cargas en el mes» en lugar de una diferencia inventada", () => {
    const html = renderToStaticMarkup(<LitersPerHourTable rows={[
      { vehicleId: "v1", equipment: "KA-1", month: "2026-03", telemetryLph: 8.1, loadsLph: 7.5, loadCount: 3, differencePct: 8 },
      { vehicleId: "v1", equipment: "KA-1", month: "2026-04", telemetryLph: 9, loadsLph: null, loadCount: 0, differencePct: null },
    ]} />)
    expect(html).toContain("Sin cargas en el mes")
    expect(html).toContain("8 %")
  })

  it("el listado de días formatea la fecha en dd-mm-aaaa", () => {
    const html = renderToStaticMarkup(<TopIdleDaysTable rows={[{ day: "2026-03-02", equipment: "KA-1", operatingHours: 10.5, idleHours: 8, idlePct: 76.2 }]} />)
    expect(html).toContain("02-03-2026")
    expect(html).toContain("76,2 %")
  })
})

describe("IdleTopEquipmentTable", () => {
  const summary = (vehicleId: string, equipment: string, idleHours: number) => ({
    vehicleId, equipment, operatingHours: 200, idleHours, idlePct: (idleHours / 200) * 100, dailyMaxPct: 34, litersIdle: null,
  })

  it("muestra horas, % en vacío y máximo diario, con «—» en los litros que la telemetría no informa, y el código abre la ficha", () => {
    const html = renderToStaticMarkup(<IdleTopEquipmentTable rows={[summary("v1", "KA-1 · AA-0001", 38)]} equipmentHref={(id) => `/combustibles/consumo/equipos/${id}?periodo=2026-03`} />)
    expect(html).toContain('href="/combustibles/consumo/equipos/v1?periodo=2026-03"')
    expect(html).toContain("200 h")
    expect(html).toContain("19 %")
    expect(html).toContain("34 %")
    expect(html).toContain("—")
  })

  it("con más equipos que el límite dice cuántos se muestran y dónde está la tabla completa", () => {
    const rows = Array.from({ length: 12 }, (_, index) => summary(`v${index}`, `EQ-${index}`, 100 - index))
    const html = renderToStaticMarkup(<IdleTopEquipmentTable rows={rows} limit={10} />)
    expect(html).toContain("Se muestran los 10 equipos")
    expect(html).toContain("de 12")
    expect(html).toContain("Por equipo y mes")
    expect(html).not.toContain("EQ-11")
  })

  it("sin telemetría explica qué hacer en vez de una tabla vacía", () => {
    const html = renderToStaticMarkup(<IdleTopEquipmentTable rows={[]} />)
    expect(html).toContain("agrega la telemetría")
    expect(html).not.toContain("<table")
  })
})

describe("LitersPerHourSection (CHART-021)", () => {
  const row = (vehicleId: string, month: string, telemetryLph: number | null, loadsLph: number | null, loadCount = 2) => ({
    vehicleId, equipment: `${vehicleId.toUpperCase()} · PL-${vehicleId}`, month, telemetryLph, loadsLph, loadCount, differencePct: null,
  })
  const render = (rows: ReturnType<typeof row>[]) => renderToStaticMarkup(<LitersPerHourSection rows={rows} equipmentHref={(id) => `/combustibles/consumo/equipos/${id}?periodo=2026-03`} cargasHref="/combustibles/cargas?periodo=2026-03" />)

  it("sin telemetría cae a la tabla vacía de siempre, sin gráfico", () => {
    const out = render([])

    expect(out).toContain("No hay telemetría en este período para comparar con las cargas.")
    expect(out).not.toContain('data-testid="lph-chart"')
  })

  it("con pares dibuja el gráfico, dice cuántos quedan fuera de la banda, lista los equipos con enlace a su ficha y conserva la tabla completa", () => {
    const out = render([row("a", "2026-03", 10.2, 10), row("b", "2026-03", 16, 10), row("c", "2026-03", 5, 10)])

    expect(out).toContain('data-testid="lph-chart"')
    expect(out).toContain("De 3 pares equipo-mes con telemetría y cargas, 2 quedan fuera de la banda de ±15 %")
    expect(out).toContain('href="/combustibles/consumo/equipos/b?periodo=2026-03"')
    expect(out).toContain('href="/combustibles/consumo/equipos/c?periodo=2026-03"')
    expect(out).not.toContain('href="/combustibles/consumo/equipos/a?periodo=2026-03"')
    // La tabla de L/h por equipo y mes sigue debajo: «Ver datos» y la tabla no se reemplazan.
    expect(out).toContain('aria-label="L/h de telemetría frente a L/h de cargas"')
    expect(out).toContain("Ver datos")
    // Pocos equipos: no se infiere una conclusión de flota.
    expect(out).toContain("Son sólo 3 equipos")
  })

  it("un mes con telemetría pero sin cargas no aparece en el gráfico: se dice, y la tabla sigue diciendo «Sin cargas en el mes»", () => {
    const out = render([row("a", "2026-03", 10.2, 10), row("a", "2026-04", 9, null, 0)])

    expect(out).toContain("1 equipo-mes con telemetría no tiene cargas con L/h para comparar")
    expect(out).toContain("Sin cargas en el mes")
  })

  it("si ninguna fila tiene los dos lados, explica el vacío con un enlace real a las cargas en vez de un gráfico en cero", () => {
    const out = render([row("a", "2026-03", 10.2, null, 0)])

    expect(out).not.toContain('data-testid="lph-chart"')
    expect(out).toContain("Ningún equipo tiene telemetría y cargas con L/h en el mismo mes")
    expect(out).toContain('href="/combustibles/cargas?periodo=2026-03"')
  })

  it("con más de 10 equipos fuera de la banda lista 10 y avisa que «Ver datos» trae todos", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(`v${index}`, "2026-03", 20 + index, 10))
    const out = render(rows)

    expect(out).toContain("Se listan 10 de 12")
    expect(out.match(/href="\/combustibles\/consumo\/equipos\/v\d+/g)).toHaveLength(10)
  })
})

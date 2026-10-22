import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { IdleEquipmentMonthRow, IdleStats } from "@/lib/combustibles/control/queries/idle"
import { resolvePagination } from "@/lib/pagination"
import { LitersPerHourTable, TopIdleDaysTable } from "./comparison-sections"
import { EquipmentMonthTable } from "./equipment-month-table"

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
    expect(renderToStaticMarkup(<EquipmentMonthTable rows={[]} total={null} pagination={pagination} hrefForPage={() => "?"} />)).toContain("importa el archivo de telemetría")
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

import { describe, expect, it } from "vitest"
import type { MantEquipmentState } from "@/lib/mantencion/types"
import {
  bucketLastDay,
  bucketWindow,
  buildWorkOrderSeries,
  outOfServiceDaysInWindows,
  pautaCompliance,
  percentChange,
  type WorkOrderSeriesRow,
} from "./indicators"

const counts = (partial: Partial<Record<MantEquipmentState, number>>): Record<MantEquipmentState, number> => ({
  vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0, ...partial,
})

const ot = (over: Partial<WorkOrderSeriesRow>): WorkOrderSeriesRow => ({
  requestDate: "2026-11-02",
  status: "solicitada",
  repair: true,
  maintenance: false,
  closedDate: null,
  voidedDate: null,
  ...over,
})

describe("bucketLastDay / bucketWindow", () => {
  it("el último día del mes respeta los bisiestos y el de un día es él mismo", () => {
    expect(bucketLastDay("2028-02", "month")).toBe("2028-02-29")
    expect(bucketLastDay("2026-11", "month")).toBe("2026-11-30")
    expect(bucketLastDay("2026-11-05", "day")).toBe("2026-11-05")
  })

  it("recorta el balde al rango y a hoy: ni antes del `desde` ni después de hoy", () => {
    const range = { from: "2026-05-10", to: "2026-11-13" }
    expect(bucketWindow("2026-05", "month", range, "2026-11-13")).toEqual({ from: "2026-05-10", to: "2026-05-31" })
    expect(bucketWindow("2026-11", "month", range, "2026-11-13")).toEqual({ from: "2026-11-01", to: "2026-11-13" })
    // Un rango que termina a medio mes pasado no se extiende hasta fin de mes.
    expect(bucketWindow("2026-09", "month", { from: "2026-07-01", to: "2026-09-15" }, "2026-11-13")).toEqual({ from: "2026-09-01", to: "2026-09-15" })
  })
})

describe("buildWorkOrderSeries", () => {
  const query = { from: "2026-09-01", to: "2026-11-13", granularity: "month" as const, today: "2026-11-13" }

  it("rellena los baldes vacíos con ceros y marca el mes en curso como parcial", () => {
    const series = buildWorkOrderSeries([], query)
    expect(series.map((point) => point.key)).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(series.every((point) => point.created === 0 && point.closed === 0 && point.backlog === 0)).toBe(true)
    expect(series.map((point) => point.partial)).toEqual([false, false, true])
  })

  it("cuenta creadas por fecha de solicitud y cerradas por fecha de cierre, no las anuladas", () => {
    const series = buildWorkOrderSeries([
      ot({ requestDate: "2026-09-10", status: "cerrada", closedDate: "2026-10-03" }),
      ot({ requestDate: "2026-10-05" }),
      ot({ requestDate: "2026-10-06", status: "anulada", voidedDate: "2026-10-07" }),
    ], query)
    expect(series.map((point) => point.created)).toEqual([1, 1, 0])
    expect(series.map((point) => point.closed)).toEqual([0, 1, 0])
  })

  it("el backlog descuenta lo cerrado y lo anulado AL FINAL del balde, no antes", () => {
    const series = buildWorkOrderSeries([
      // Pedida en septiembre, cerrada el 3 de octubre: sigue en el backlog de fines de septiembre.
      ot({ requestDate: "2026-09-10", status: "cerrada", closedDate: "2026-10-03" }),
      // Pedida en octubre y anulada el 7 de octubre: está en el de septiembre? no (no existía); en el de octubre ya no.
      ot({ requestDate: "2026-10-05", status: "anulada", voidedDate: "2026-10-07" }),
      // Abierta desde septiembre.
      ot({ requestDate: "2026-09-20" }),
    ], query)
    expect(series.map((point) => point.backlog)).toEqual([2, 1, 1])
  })

  it("cerrada el último día del balde ya no cuenta en su backlog", () => {
    const series = buildWorkOrderSeries([ot({ requestDate: "2026-09-10", status: "cerrada", closedDate: "2026-09-30" })], query)
    expect(series[0]!.backlog).toBe(0)
  })

  it("el balde en curso mide el backlog a hoy y no cuenta lo pedido mañana", () => {
    const series = buildWorkOrderSeries([ot({ requestDate: "2026-11-14" }), ot({ requestDate: "2026-11-13" })], { ...query, to: "2026-11-30" })
    expect(series.at(-1)!.backlog).toBe(1)
  })

  it("separa reparación, mantención y las que son ambas", () => {
    const series = buildWorkOrderSeries([
      ot({ requestDate: "2026-11-02", repair: true, maintenance: false }),
      ot({ requestDate: "2026-11-03", repair: false, maintenance: true }),
      ot({ requestDate: "2026-11-04", repair: true, maintenance: true }),
    ], query)
    const nov = series.at(-1)!
    expect([nov.repairOnly, nov.maintenanceOnly, nov.both, nov.created]).toEqual([1, 1, 1, 3])
  })

  it("por día: un cierre fuera del rango no suma", () => {
    const series = buildWorkOrderSeries(
      [ot({ requestDate: "2026-11-01", status: "cerrada", closedDate: "2026-11-20" })],
      { from: "2026-11-05", to: "2026-11-07", granularity: "day", today: "2026-11-13" },
    )
    expect(series.map((point) => point.closed)).toEqual([0, 0, 0])
    expect(series.map((point) => point.backlog)).toEqual([1, 1, 1])
  })
})

describe("outOfServiceDaysInWindows", () => {
  // Chile en noviembre es UTC-3 (horario de verano): el 1 de noviembre local empieza a las 03:00Z.
  const NOW = new Date("2026-11-13T15:00:00Z")

  it("traslapa un intervalo cerrado con cada ventana", () => {
    const [nov1, nov2, both] = outOfServiceDaysInWindows(
      [{ startedAt: "2026-11-01T15:00:00Z", endedAt: "2026-11-02T15:00:00Z" }],
      [{ from: "2026-11-01", to: "2026-11-01" }, { from: "2026-11-02", to: "2026-11-02" }, { from: "2026-11-01", to: "2026-11-05" }],
      NOW,
    )
    // 12:00 local del 1 al 12:00 local del 2: medio día en cada fecha civil.
    expect(nov1).toBeCloseTo(0.5, 5)
    expect(nov2).toBeCloseTo(0.5, 5)
    expect(both).toBeCloseTo(1, 5)
  })

  it("un intervalo abierto termina en `now` y el futuro no se mide", () => {
    const [days, future] = outOfServiceDaysInWindows(
      [{ startedAt: "2026-11-10T03:00:00Z", endedAt: null }],
      [{ from: "2026-11-10", to: "2026-11-20" }, { from: "2026-11-15", to: "2026-11-20" }],
      NOW,
    )
    // Del 10 a las 00:00 locales hasta el 13 a las 12:00 locales: 3,5 días.
    expect(days).toBeCloseTo(3.5, 5)
    expect(future).toBe(0)
  })

  it("un intervalo que empezó antes de la ventana sólo aporta lo que cae dentro", () => {
    const [days] = outOfServiceDaysInWindows(
      [{ startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-11-03T03:00:00Z" }],
      [{ from: "2026-11-01", to: "2026-11-30" }],
      NOW,
    )
    expect(days).toBeCloseTo(2, 5)
  })

  it("suma varios equipos y no cuenta lo que termina antes de la ventana", () => {
    const [days] = outOfServiceDaysInWindows(
      [
        { startedAt: "2026-11-05T03:00:00Z", endedAt: "2026-11-06T03:00:00Z" },
        { startedAt: "2026-11-05T03:00:00Z", endedAt: "2026-11-07T03:00:00Z" },
        { startedAt: "2026-10-01T03:00:00Z", endedAt: "2026-10-02T03:00:00Z" },
      ],
      [{ from: "2026-11-05", to: "2026-11-10" }],
      NOW,
    )
    expect(days).toBeCloseTo(3, 5)
  })
})

describe("pautaCompliance", () => {
  it("al día sobre los equipos con pauta, sin contar bajas ni sin pauta", () => {
    expect(pautaCompliance(counts({ vencida: 2, proxima: 1, al_dia: 5, sin_lecturas: 2, sin_pauta: 10, baja: 3 })))
      .toEqual({ withSchedule: 10, onTime: 5, percent: 50 })
  })

  it("sin equipos con pauta no hay porcentaje", () => {
    expect(pautaCompliance(counts({ sin_pauta: 4, baja: 1 })).percent).toBeNull()
  })
})

describe("percentChange", () => {
  it("compara contra el período anterior y calla sin base", () => {
    expect(percentChange(15, 10)).toBe(50)
    expect(percentChange(5, 10)).toBe(-50)
    expect(percentChange(0, 10)).toBe(-100)
    expect(percentChange(4, 0)).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import {
  copecChannelCell,
  coverageColumns,
  coverageWindow,
  dailySourceCell,
  summarizeCoverage,
  type CopecCoverageMonthRow,
} from "../coverage-matrix"

const TODAY = "2026-11-03"

describe("coverageWindow", () => {
  it("son los últimos 12 meses terminando en el mes en curso, del más antiguo al más nuevo", () => {
    const months = coverageWindow(TODAY)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe("2025-12")
    expect(months[11]).toBe("2026-11")
    expect(coverageWindow("2026-01-15", 3)).toEqual(["2025-11", "2025-12", "2026-01"])
  })
})

describe("coverageColumns", () => {
  it("rotula con el mes y agrega el año sólo en la primera columna y en enero", () => {
    const columns = coverageColumns(["2025-12", "2026-01", "2026-02"])
    expect(columns.map((column) => column.label)).toEqual(["Dic 25", "Ene 26", "Feb"])
    expect(columns[0]).toMatchObject({ key: "2025-12", title: "Diciembre 2025" })
  })
})

const account = (sourceAccount: string, status: string, rowsAccepted = 0, quantityTotal = 0): CopecCoverageMonthRow => ({ sourceAccount, status, rowsAccepted, quantityTotal })
const closedTct = [account("tct:diesel", "complete", 120, 18_400), account("tct:bluemax", "complete", 8, 640)]

describe("copecChannelCell", () => {
  const base = { channel: "TCT" as const, today: TODAY, firstMonth: "2026-01" }

  it("las dos cuentas del canal con cobertura terminal son un mes completo, con sus filas y litros", () => {
    expect(copecChannelCell({ ...base, month: "2026-10", rows: closedTct })).toEqual({ status: "ok", detail: "128 filas, 19.040 L" })
  })

  it("un mes cerrado sin movimientos (cobertura «legítimamente vacío») es completo y lo dice", () => {
    const rows = [account("tct:diesel", "legitimate_empty"), account("tct:bluemax", "legitimate_empty")]
    expect(copecChannelCell({ ...base, month: "2026-08", rows })).toEqual({ status: "ok", detail: "cerrado sin movimientos" })
  })

  it("sólo cuentan las cuentas del canal: la cobertura del otro canal no cierra este", () => {
    const rows = [...closedTct, account("tae:diesel", "incomplete", 5, 300)]
    expect(copecChannelCell({ ...base, channel: "TAE", month: "2026-10", rows })).toMatchObject({ status: "partial" })
    expect(copecChannelCell({ ...base, channel: "TCT", month: "2026-10", rows })).toMatchObject({ status: "ok" })
  })

  it("con filas pero sin cerrar es parcial: la cifra existe, pero el mes no está certificado", () => {
    const rows = [account("tct:diesel", "incomplete", 90, 12_000), account("tct:bluemax", "unknown")]
    expect(copecChannelCell({ ...base, month: "2026-10", rows })).toEqual({ status: "partial", detail: "90 filas, 12.000 L, sin cerrar" })
  })

  it("un mes con sólo una de las dos cuentas cerrada no está completo", () => {
    const rows = [account("tct:diesel", "complete", 90, 12_000)]
    expect(copecChannelCell({ ...base, month: "2026-10", rows })).toMatchObject({ status: "partial" })
  })

  it("un hueco conocido del proveedor (septiembre de 2026: ninguna fila de cobertura) es «sin datos», no un cero", () => {
    expect(copecChannelCell({ ...base, month: "2026-09", rows: [] })).toEqual({ status: "missing", detail: "sin datos del proveedor" })
  })

  it("cobertura sin filas aceptadas y con una lectura fallida lo dice", () => {
    const rows = [account("tct:diesel", "failed"), account("tct:bluemax", "unknown")]
    expect(copecChannelCell({ ...base, month: "2026-09", rows })).toEqual({ status: "missing", detail: "la última lectura del proveedor falló" })
  })

  it("el mes en curso está «en curso», con lo que lleva, aunque la cobertura no cierre", () => {
    const rows = [account("tct:diesel", "incomplete", 14, 2_100)]
    expect(copecChannelCell({ ...base, month: "2026-11", rows })).toEqual({ status: "upcoming", detail: "14 filas, 2.100 L hasta ahora" })
    expect(copecChannelCell({ ...base, month: "2026-11", rows: [] })).toEqual({ status: "upcoming", detail: "sin datos todavía" })
  })

  it("antes de que la integración existiera el mes no aplica; sin ninguna cobertura, tampoco", () => {
    expect(copecChannelCell({ ...base, month: "2025-12", rows: [] })).toEqual({ status: "na", detail: "la integración aún no leía este canal" })
    expect(copecChannelCell({ ...base, firstMonth: null, month: "2026-10", rows: [] })).toMatchObject({ status: "na" })
  })

  it("un mes futuro no es un hueco", () => {
    expect(copecChannelCell({ ...base, month: "2026-12", rows: [] })).toMatchObject({ status: "upcoming" })
  })
})

describe("dailySourceCell", () => {
  const base = { today: TODAY, firstDay: "2026-07-01", completeRatio: 0.9, unit: "con datos" }

  it("un mes cerrado con casi todos los días con datos es completo; el detalle dice cuántos", () => {
    expect(dailySourceCell({ ...base, month: "2026-10", daysWithData: 31, extra: "6 equipos, 8.400 L" })).toEqual({ status: "ok", detail: "31 de 31 días con datos, 6 equipos, 8.400 L" })
    // 28 de 31 todavía pasa (días sin operación: feriados, fines de semana largos); 27 no.
    expect(dailySourceCell({ ...base, month: "2026-10", daysWithData: 28 })).toMatchObject({ status: "ok" })
    expect(dailySourceCell({ ...base, month: "2026-10", daysWithData: 27 })).toEqual({ status: "partial", detail: "27 de 31 días con datos" })
  })

  it("un mes cerrado sin ningún día es «sin datos»", () => {
    expect(dailySourceCell({ ...base, month: "2026-09", daysWithData: 0 })).toEqual({ status: "missing", detail: "0 de 30 días con datos" })
  })

  it("con tolerancia cero (una sincronización debe correr todos los días) un solo día que falta ya es parcial", () => {
    const strict = { ...base, completeRatio: 1, unit: "con sincronización" }
    expect(dailySourceCell({ ...strict, month: "2026-10", daysWithData: 30 })).toEqual({ status: "partial", detail: "30 de 31 días con sincronización" })
    expect(dailySourceCell({ ...strict, month: "2026-10", daysWithData: 31 })).toMatchObject({ status: "ok" })
  })

  it("el mes en curso se mide hasta ayer: la fuente caída desde hace días no se disfraza de «en curso»", () => {
    // El 3 de noviembre se esperan los días 1 y 2. OnWay caído desde el 30 de octubre: cero.
    expect(dailySourceCell({ ...base, completeRatio: 1, unit: "con sincronización", month: "2026-11", daysWithData: 0 }))
      .toEqual({ status: "missing", detail: "0 de 2 días con sincronización, hasta ayer" })
    expect(dailySourceCell({ ...base, completeRatio: 1, unit: "con sincronización", month: "2026-11", daysWithData: 1 }))
      .toEqual({ status: "partial", detail: "1 de 2 días con sincronización, hasta ayer" })
    expect(dailySourceCell({ ...base, month: "2026-11", daysWithData: 2 })).toEqual({ status: "ok", detail: "2 de 2 días con datos, hasta ayer" })
  })

  it("los datos de hoy no suman a los días esperados", () => {
    expect(dailySourceCell({ ...base, month: "2026-11", daysWithData: 3 })).toMatchObject({ status: "ok", detail: "2 de 2 días con datos, hasta ayer" })
  })

  it("el primer día del mes todavía no hay un día completo que esperar: queda «en curso»", () => {
    expect(dailySourceCell({ ...base, today: "2026-11-01", month: "2026-11", daysWithData: 0 })).toMatchObject({ status: "upcoming" })
  })

  it("el mes en que la fuente empezó sólo espera los días desde que empezó", () => {
    expect(dailySourceCell({ ...base, firstDay: "2026-07-20", month: "2026-07", daysWithData: 12 })).toEqual({ status: "ok", detail: "12 de 12 días con datos" })
  })

  it("antes de su primer dato el mes no aplica; sin ningún dato, tampoco", () => {
    expect(dailySourceCell({ ...base, month: "2026-06", daysWithData: 0 })).toMatchObject({ status: "na" })
    expect(dailySourceCell({ ...base, firstDay: null, month: "2026-10", daysWithData: 0 })).toMatchObject({ status: "na" })
  })
})

describe("summarizeCoverage", () => {
  const row = (label: string, statuses: Array<"ok" | "partial" | "missing" | "upcoming" | "na">) => ({
    id: label, label, cells: statuses.map((status) => ({ status })),
  })
  const months = ["2026-08", "2026-09", "2026-10", "2026-11"]

  it("nombra la fuente y los meses con hueco, y no cuenta el mes en curso ni lo que no aplica", () => {
    const text = summarizeCoverage(months, [
      row("Copec: tarjeta de equipos", ["ok", "missing", "ok", "upcoming"]),
      row("Telemetría de equipos", ["na", "ok", "partial", "ok"]),
      row("GPS OnWay", ["na", "na", "ok", "missing"]),
    ])
    expect(text).toBe("Hay huecos en 3 de 3 fuentes: Copec: tarjeta de equipos (sep 2026), Telemetría de equipos (oct 2026) y GPS OnWay (nov 2026).")
  })

  it("si nada falta lo dice", () => {
    expect(summarizeCoverage(months, [row("Copec: tarjeta de equipos", ["ok", "ok", "ok", "upcoming"])]))
      .toBe("Todas las fuentes tienen datos completos en los últimos meses cerrados.")
  })

  it("con muchos meses por fuente abrevia", () => {
    const many = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]
    expect(summarizeCoverage(many, [row("GPS OnWay", ["missing", "missing", "partial", "missing", "ok"])]))
      .toBe("Hay huecos en 1 de 1 fuente: GPS OnWay (ene 2026, feb 2026, mar 2026 y 1 más).")
  })

  it("sin fuentes no hay frase", () => {
    expect(summarizeCoverage(months, [])).toBeNull()
  })
})

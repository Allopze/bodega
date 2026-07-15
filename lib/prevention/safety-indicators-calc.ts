/**
 * Cálculos puros de indicadores de accidentabilidad — sin dependencias de
 * DB, importable tanto desde el servicio (server) como desde componentes
 * cliente (modal de edición, gráficos) para el cálculo en vivo.
 */

export type IndicatorCounters = {
  trabajadores: number
  horasHombre: number
  accConTiempoPerdido: number
  accSinTiempoPerdido: number
  diasPerdidos: number
  incidentes: number
  danoMaterial: number
  danoAmbiental: number
}

export const EMPTY_COUNTERS: IndicatorCounters = {
  trabajadores: 0, horasHombre: 0, accConTiempoPerdido: 0, accSinTiempoPerdido: 0,
  diasPerdidos: 0, incidentes: 0, danoMaterial: 0, danoAmbiental: 0,
}

/** tasaFrecuencia = accCTP/HH·1.000.000, tasaGravedad = diasPerdidos/HH·1.000. */
export function calcRates(d: Pick<IndicatorCounters, "horasHombre" | "accConTiempoPerdido" | "accSinTiempoPerdido" | "diasPerdidos">) {
  const hh = d.horasHombre || 0
  const tasaFrecuencia = hh > 0 ? (d.accConTiempoPerdido / hh) * 1_000_000 : 0
  const tasaGravedad = hh > 0 ? (d.diasPerdidos / hh) * 1_000 : 0
  const totalAccidentes = (d.accConTiempoPerdido || 0) + (d.accSinTiempoPerdido || 0)
  return { tasaFrecuencia, tasaGravedad, totalAccidentes }
}

export function sumCounters(rows: IndicatorCounters[]): IndicatorCounters {
  return rows.reduce((acc, r) => ({
    trabajadores: acc.trabajadores + r.trabajadores,
    horasHombre: acc.horasHombre + r.horasHombre,
    accConTiempoPerdido: acc.accConTiempoPerdido + r.accConTiempoPerdido,
    accSinTiempoPerdido: acc.accSinTiempoPerdido + r.accSinTiempoPerdido,
    diasPerdidos: acc.diasPerdidos + r.diasPerdidos,
    incidentes: acc.incidentes + r.incidentes,
    danoMaterial: acc.danoMaterial + r.danoMaterial,
    danoAmbiental: acc.danoAmbiental + r.danoAmbiental,
  }), { ...EMPTY_COUNTERS })
}

/**
 * Arma, para una faena dada (o "total" = suma de todas las filas), los 12
 * meses del año con sus contadores (0 si no hay fila para ese mes).
 */
export function buildMonthlyCounters(
  rows: Array<IndicatorCounters & { worksiteId: string; month: number }>,
  worksiteId: string | "total",
): IndicatorCounters[] {
  const relevant = worksiteId === "total" ? rows : rows.filter((r) => r.worksiteId === worksiteId)
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const monthRows = relevant.filter((r) => r.month === month)
    return monthRows.length > 0 ? sumCounters(monthRows) : { ...EMPTY_COUNTERS }
  })
}

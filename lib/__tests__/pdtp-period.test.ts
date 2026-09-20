import { describe, expect, it } from "vitest"
import {
  countOverdueMonths,
  currentPdtpPeriod,
  deriveActivityStatus,
  effectiveActivationFor,
  filterPdtpRowsFromActivation,
  isPdtpActivityZeroThisMonth,
  isPdtpPeriodOnOrAfterActivation,
  type PdtpPeriod,
} from "@/lib/services/pdtp/period"

// El período se resuelve en hora de Chile, así que los casos se expresan como
// instantes UTC explícitos (mediodía chileno) y no con `new Date(y, m, d)`, que
// depende de la zona del proceso.
const atChile = (day: string) => new Date(`${day}T15:00:00Z`)

describe("currentPdtpPeriod", () => {
  it("computes year from the date", () => {
    expect(currentPdtpPeriod(atChile("2026-07-04")).year).toBe(2026)
  })

  it("computes month from the date (1-12)", () => {
    expect(currentPdtpPeriod(atChile("2026-07-04")).month).toBe(7)
  })

  it("computes week 1 for days 1-7", () => {
    expect(currentPdtpPeriod(atChile("2026-07-01")).week).toBe(1)
    expect(currentPdtpPeriod(atChile("2026-07-07")).week).toBe(1)
  })

  it("computes week 2 for days 8-14", () => {
    expect(currentPdtpPeriod(atChile("2026-07-08")).week).toBe(2)
    expect(currentPdtpPeriod(atChile("2026-07-14")).week).toBe(2)
  })

  it("computes week 3 for days 15-21", () => {
    expect(currentPdtpPeriod(atChile("2026-07-15")).week).toBe(3)
    expect(currentPdtpPeriod(atChile("2026-07-21")).week).toBe(3)
  })

  it("computes week 4 for days 22-31", () => {
    expect(currentPdtpPeriod(atChile("2026-07-22")).week).toBe(4)
    expect(currentPdtpPeriod(atChile("2026-07-28")).week).toBe(4)
    expect(currentPdtpPeriod(atChile("2026-07-31")).week).toBe(4)
  })

  // Regresión D-06: el proceso corre en UTC en producción. A las 21:00 del 31
  // de diciembre en Chile ya es 1 de enero en UTC, y el período saltaba de año.
  it("resolves the period in Chile time, not the process timezone", () => {
    const period = currentPdtpPeriod(new Date("2027-01-01T02:00:00Z"))
    expect(period.year).toBe(2026)
    expect(period.month).toBe(12)
    expect(period.week).toBe(4)
  })

  it("uses current date by default", () => {
    const period = currentPdtpPeriod()
    const now = currentPdtpPeriod(new Date())
    expect(period.year).toBe(now.year)
    expect(period.month).toBe(now.month)
  })
})

describe("vigencia del programa PDTP", () => {
  const activatedAt = "2026-07-15T15:00:00.000Z"

  it("incluye la semana de aceptación y todas las posteriores hasta fin de año", () => {
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 2 }, activatedAt)).toBe(false)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 3 }, activatedAt)).toBe(true)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 12, week: 4 }, activatedAt)).toBe(true)
  })

  it("excluye filas anteriores y conserva programas históricos sin activatedAt", () => {
    const rows = [
      { year: 2026, month: 1, week: 1, value: "antes" },
      { year: 2026, month: 7, week: 3, value: "aceptación" },
      { year: 2026, month: 10, week: 1, value: "después" },
    ]
    expect(filterPdtpRowsFromActivation(rows, activatedAt).map((row) => row.value))
      .toEqual(["aceptación", "después"])
    expect(filterPdtpRowsFromActivation(rows, null)).toBe(rows)
  })

  it("resuelve la aceptación con fecha chilena cerca de medianoche UTC", () => {
    // En Chile aún es 14 de julio (semana 2), aunque en UTC ya sea día 15.
    const nearMidnight = "2026-07-15T02:30:00.000Z"
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 1 }, nearMidnight)).toBe(false)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 2 }, nearMidnight)).toBe(true)
  })
})

describe("effectiveActivationFor", () => {
  const activatedAt = "2026-04-10T12:00:00.000Z"

  it("sin fecha de incorporación devuelve el corte del programa", () => {
    expect(effectiveActivationFor(activatedAt, null)).toBe(activatedAt)
    expect(effectiveActivationFor(activatedAt, undefined)).toBe(activatedAt)
  })

  it("sin activación del programa devuelve la incorporación de la faena", () => {
    expect(effectiveActivationFor(null, "2026-10-01T12:00:00.000Z")).toBe("2026-10-01T12:00:00.000Z")
  })

  it("con ambas, gana la más tardía", () => {
    // Faena preexistente: el programa se activa después y manda él.
    expect(effectiveActivationFor(activatedAt, "2026-01-05T12:00:00.000Z")).toBe(activatedAt)
    // Faena incorporada tarde: manda su fecha, no la del programa.
    expect(effectiveActivationFor(activatedAt, "2026-10-01T12:00:00.000Z")).toBe("2026-10-01T12:00:00.000Z")
  })

  it("compara por instante y no por texto", () => {
    /* Postgres devuelve `2026-10-01 12:00:00+00` y `toISOString()` devuelve
     * `2026-10-01T12:00:00.000Z`. Comparadas como cadenas, el espacio (0x20)
     * siempre pierde contra la T (0x54), así que la fecha de la faena nunca
     * ganaría si vino de la base — que es de donde siempre viene. */
    const fromPostgres = "2026-10-01 12:00:00+00"
    expect(effectiveActivationFor(activatedAt, fromPostgres)).toBe(fromPostgres)
  })

  it("una fecha inválida no manda", () => {
    expect(effectiveActivationFor(activatedAt, "no es una fecha")).toBe(activatedAt)
  })

  it("ninguna de las dos deja el corte sin resolver, que significa exigir todo", () => {
    expect(effectiveActivationFor(null, null)).toBe(null)
  })
})

describe("deriveActivityStatus", () => {
  it("returns 'not_scheduled' when nothing is planned for the month", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("not_scheduled")
  })

  it("returns 'executed' when something was executed in the current month", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("executed")
  })

  it("returns 'pending' when planned this month but not executed and no earlier unexecuted months", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })

  it("returns 'overdue' when planned in an earlier month with nothing executed", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("overdue")
  })

  it("returns 'executed' even if there are earlier unexecuted months, as long as current month is executed", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("executed")
  })

  it("handles undefined values in arrays (treats as 0)", () => {
    const monthlyPlanned = [undefined, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] as unknown as number[]
    const monthlyExecuted = [undefined, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as number[]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })

  it("detects overdue when multiple earlier months have unexecuted plans", () => {
    const monthlyPlanned = [1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 2 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("overdue")
  })

  it("is pending when earlier months are fully executed but current month is not", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })
})

/**
 * Fase 3 (desvíos por celda). `monthlyNotPerformed` cuenta los desvíos "no
 * realizada" activos por mes: no tocan lo planificado (eso lo hacen
 * `not_applicable` y `reprogrammed`, y ya viene aplicado desde la costura
 * única), sólo declaran el motivo. Lo que estos casos fijan es dónde SÍ
 * cambia el resultado (estado del mes, arrastre de atraso) y dónde NO
 * (el criterio "en cero" del indicador).
 */
describe("deriveActivityStatus — desvíos 'no realizada'", () => {
  const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }
  const zeros = () => Array.from({ length: 12 }, () => 0)
  const at = (month: number, value: number) => {
    const arr = zeros()
    arr[month - 1] = value
    return arr
  }

  it("declara 'no realizada' el mes en curso planificado, sin ejecutar y con motivo", () => {
    const status = deriveActivityStatus(at(7, 1), zeros(), period, { monthlyNotPerformed: at(7, 1) })
    expect(status).toBe("not_performed")
  })

  it("una ejecución del mes gana sobre la declaración: sigue siendo 'ejecutado'", () => {
    const status = deriveActivityStatus(at(7, 1), at(7, 2), period, { monthlyNotPerformed: at(7, 1) })
    expect(status).toBe("executed")
  })

  it("sin planificación en el mes, un desvío no inventa estado: sigue 'no programada'", () => {
    const status = deriveActivityStatus(zeros(), zeros(), period, { monthlyNotPerformed: at(7, 1) })
    expect(status).toBe("not_scheduled")
  })

  it("un mes anterior con 'no realizada' declarada no arrastra el atraso", () => {
    const planned = zeros()
    planned[2] = 1 // marzo planificado sin ejecutar
    planned[6] = 1 // julio, el mes en curso
    expect(deriveActivityStatus(planned, zeros(), period)).toBe("overdue")
    expect(deriveActivityStatus(planned, zeros(), period, { monthlyNotPerformed: at(3, 1) })).toBe("pending")
  })

  it("un mes anterior sin declarar sigue produciendo atraso aunque otro sí esté declarado", () => {
    const planned = zeros()
    planned[2] = 1 // marzo: declarado
    planned[4] = 1 // mayo: en silencio
    planned[6] = 1
    const status = deriveActivityStatus(planned, zeros(), period, { monthlyNotPerformed: at(3, 1) })
    expect(status).toBe("overdue")
  })

  it("countOverdueMonths no cuenta los meses ya declarados", () => {
    const planned = zeros()
    planned[2] = 1
    planned[4] = 1
    planned[6] = 1
    expect(countOverdueMonths(planned, zeros(), period)).toBe(2)
    expect(countOverdueMonths(planned, zeros(), period, { monthlyNotPerformed: at(3, 1) })).toBe(1)
  })

  it("sin opciones, el comportamiento es exactamente el previo a los desvíos", () => {
    const planned = at(7, 1)
    expect(deriveActivityStatus(planned, zeros(), period, {})).toBe("pending")
    expect(deriveActivityStatus(planned, zeros(), period, { monthlyNotPerformed: undefined })).toBe("pending")
  })

  it("una 'no realizada' declarada sigue contando en cero para el indicador", () => {
    // `isPdtpActivityZeroThisMonth` no recibe `monthlyNotPerformed` a
    // propósito: el planificado no cambió, así que `compliance.ts` sigue
    // contando la actividad en `zeroActivityIds` y el filtro del visor tiene
    // que mostrar lo mismo que el indicador cuenta.
    expect(isPdtpActivityZeroThisMonth({ indicatorMode: "planned_vs_completed" }, at(7, 1), zeros(), period)).toBe(true)
  })
})

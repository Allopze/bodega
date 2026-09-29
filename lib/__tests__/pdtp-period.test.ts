import { describe, expect, it } from "vitest"
import {
  aggregatePdtpActivityStatus,
  countOverdueMonths,
  currentPdtpPeriod,
  deriveActivityStatus,
  effectiveActivationFor,
  filterPdtpRowsFromActivation,
  isPdtpActivityZeroThisMonth,
  isPdtpPeriodOnOrAfterActivation,
  pdtpFirstOverdueMonth,
  pdtpOverdueCutoffMonth,
  pdtpPeriodFromChileDate,
  pdtpReferencePeriodForYear,
  pdtpSheetActivityStatus,
  resolvePdtpOperationalYears,
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
  // PRV-07 (auditoría 2026-09-28): 1 de 4 en un mes vencido es deuda, no "hecho".
  it("un mes vencido ejecutado sólo en parte cuenta como atrasado", () => {
    const planned = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const executed = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period = { year: 2026, month: 3, week: 1 }
    expect(deriveActivityStatus(planned, executed, period)).toBe("overdue")
    expect(countOverdueMonths(planned, executed, period)).toBe(1)
    // Cubierto completo, ya no.
    expect(deriveActivityStatus(planned, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], period)).toBe("not_scheduled")
  })

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

  // PREV-C06: antes devolvía "executed" — una ejecución del mes en curso
  // escondía un mes anterior en cero. La deuda vencida se evalúa primero.
  it("returns 'overdue' when an earlier month is unpaid, even if the current month is executed", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("overdue")
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

describe("resolvePdtpOperationalYears — año operativo y cierre pendiente (PREV-C03.7, D23)", () => {
  const program = (year: number, status: string, yearClosedAt: string | null = null) => ({ year, status, yearClosedAt })

  it("enero con el año anterior activo y el nuevo en borrador: el operativo sigue siendo el anterior", () => {
    expect(resolvePdtpOperationalYears([program(2026, "active"), program(2027, "draft")], 2027))
      .toEqual({ primary: 2026, closing: null })
  })

  it("con los dos activos, el operativo es el nuevo y el anterior queda con cierre pendiente", () => {
    expect(resolvePdtpOperationalYears([program(2026, "active"), program(2027, "active")], 2027))
      .toEqual({ primary: 2027, closing: 2026 })
  })

  it("con el año anterior cerrado formalmente, no queda cierre pendiente", () => {
    expect(resolvePdtpOperationalYears([program(2026, "closed", "2027-01-20T12:00:00.000Z"), program(2027, "active")], 2027))
      .toEqual({ primary: 2027, closing: null })
  })

  it("sin programas, el año civil", () => {
    expect(resolvePdtpOperationalYears([], 2027)).toEqual({ primary: 2027, closing: null })
  })

  it("en diciembre con el año siguiente ya activo, el operativo sigue siendo el año en curso", () => {
    expect(resolvePdtpOperationalYears([program(2026, "active"), program(2027, "active")], 2026))
      .toEqual({ primary: 2026, closing: null })
  })
})

describe("pdtpReferencePeriodForYear", () => {
  const today = { year: 2027, month: 1, week: 2 }

  it("el año en curso se mide a hoy", () => {
    expect(pdtpReferencePeriodForYear(2027, today)).toEqual(today)
  })

  it("un año ya terminado —el que está en cierre— se mide completo, en diciembre", () => {
    expect(pdtpReferencePeriodForYear(2026, today)).toEqual({ year: 2026, month: 12, week: 4 })
  })

  it("un año que aún no empieza se mide en su primera semana", () => {
    expect(pdtpReferencePeriodForYear(2028, today)).toEqual({ year: 2028, month: 1, week: 1 })
  })
})

/**
 * PREV-C06 (T2): el atraso se evalúa primero y sobre los meses ya vencidos,
 * no sólo sobre el mes en curso. Antes una trimestral no hecha en marzo se
 * veía en mayo como "No programada en este período" y una ejecución de este
 * mes escondía los meses anteriores en cero.
 */
describe("PREV-C06 — atraso por deuda vencida", () => {
  const zeros = () => Array.from({ length: 12 }, () => 0)
  const at = (entries: Record<number, number>) => {
    const arr = zeros()
    for (const [month, value] of Object.entries(entries)) arr[Number(month) - 1] = value
    return arr
  }

  describe("pdtpOverdueCutoffMonth", () => {
    it("año en curso: vencen los meses anteriores al mes de hoy", () => {
      expect(pdtpOverdueCutoffMonth(2026, { year: 2026, month: 5, week: 2 }, { year: 2026, month: 5, week: 2 })).toBe(4)
    })

    it("mirar un mes futuro no adelanta el vencimiento: manda hoy", () => {
      expect(pdtpOverdueCutoffMonth(2026, { year: 2026, month: 9, week: 1 }, { year: 2026, month: 5, week: 2 })).toBe(4)
    })

    it("mirar un mes pasado mide la deuda a ese mes", () => {
      expect(pdtpOverdueCutoffMonth(2026, { year: 2026, month: 3, week: 1 }, { year: 2026, month: 5, week: 2 })).toBe(2)
    })

    it("un año terminado leído en diciembre (pdtpReferencePeriodForYear) tiene los 12 meses vencidos", () => {
      const today = { year: 2027, month: 1, week: 2 }
      expect(pdtpOverdueCutoffMonth(2026, pdtpReferencePeriodForYear(2026, today), today)).toBe(12)
    })

    it("un año que no empieza no tiene nada vencido", () => {
      expect(pdtpOverdueCutoffMonth(2028, { year: 2028, month: 1, week: 1 }, { year: 2027, month: 1, week: 2 })).toBe(0)
    })
  })

  const period: PdtpPeriod = { year: 2026, month: 5, week: 2 }

  it("una trimestral no hecha en marzo es 'atrasada' en mayo aunque mayo no tenga plan", () => {
    const planned = at({ 3: 1, 6: 1 })
    expect(deriveActivityStatus(planned, zeros(), period, { today: period })).toBe("overdue")
    expect(countOverdueMonths(planned, zeros(), period, { today: period })).toBe(1)
  })

  it("una ejecución de este mes no esconde un mes anterior en cero", () => {
    const planned = at({ 2: 1, 5: 1 })
    expect(deriveActivityStatus(planned, at({ 5: 1 }), period, { today: period })).toBe("overdue")
  })

  it("D9: un mes con un envío pendiente de aprobación no cuenta como atraso", () => {
    const planned = at({ 3: 1, 5: 1 })
    expect(deriveActivityStatus(planned, zeros(), period, { today: period, monthlySubmitted: at({ 3: 1 }) })).toBe("pending")
    expect(countOverdueMonths(planned, zeros(), period, { today: period, monthlySubmitted: at({ 3: 1 }) })).toBe(0)
  })

  it("el mes en curso todavía no vence: planificado y sin ejecutar es 'pendiente'", () => {
    expect(deriveActivityStatus(at({ 5: 1 }), zeros(), period, { today: period })).toBe("pending")
  })

  it("un año cerrado se mide completo: diciembre sin ejecutar también es atraso", () => {
    const today = { year: 2027, month: 1, week: 2 }
    const reference = pdtpReferencePeriodForYear(2026, today)
    expect(deriveActivityStatus(at({ 12: 1 }), zeros(), reference, { programYear: 2026, today })).toBe("overdue")
  })

  it("mirar un mes futuro no vuelve 'atrasados' los meses que todavía no terminan", () => {
    const today = { year: 2026, month: 5, week: 2 }
    const future = { year: 2026, month: 9, week: 1 }
    expect(deriveActivityStatus(at({ 6: 1, 9: 1 }), zeros(), future, { today })).toBe("pending")
  })

  it("pdtpFirstOverdueMonth devuelve el primer mes vencido sin pagar", () => {
    const planned = at({ 2: 1, 3: 1, 5: 1 })
    expect(pdtpFirstOverdueMonth(planned, at({ 2: 1 }), period, { today: period })).toBe(3)
    expect(pdtpFirstOverdueMonth(at({ 5: 1 }), zeros(), period, { today: period })).toBeNull()
  })

  it("'en cero' sigue siendo sólo el mes en curso: la deuda anterior no mete una actividad ejecutada este mes", () => {
    const planned = at({ 2: 1, 5: 1 })
    expect(isPdtpActivityZeroThisMonth({ indicatorMode: null }, planned, at({ 5: 1 }), period)).toBe(false)
    expect(isPdtpActivityZeroThisMonth({ indicatorMode: null }, planned, zeros(), period)).toBe(true)
  })

  describe("aggregatePdtpActivityStatus — peor caso entre faenas", () => {
    it("una faena atrasada hace atrasada a la actividad aunque otra esté ejecutada", () => {
      expect(aggregatePdtpActivityStatus(["executed", "overdue", "not_scheduled"])).toBe("overdue")
    })

    it("sin atrasos, 'no realizada' pesa más que 'pendiente' y ésta más que 'ejecutada'", () => {
      expect(aggregatePdtpActivityStatus(["executed", "pending", "not_performed"])).toBe("not_performed")
      expect(aggregatePdtpActivityStatus(["executed", "pending"])).toBe("pending")
      expect(aggregatePdtpActivityStatus(["not_scheduled", "executed"])).toBe("executed")
    })

    it("sin faenas no hay estado que agregar", () => {
      expect(aggregatePdtpActivityStatus([])).toBe("not_scheduled")
    })
  })

  describe("pdtpSheetActivityStatus — la única regla de la planilla y del KPI", () => {
    const context = { programYear: 2026, today: period }

    it("vista por faena: deriva de los arreglos efectivos y cuenta lo enviado como pagado (D9)", () => {
      const activity = { effectiveMonthlyPlanned: at({ 3: 1, 5: 1 }), effectiveMonthlyExecuted: zeros(), monthlyNotPerformed: zeros() }
      expect(pdtpSheetActivityStatus(activity, period, context)).toEqual({ status: "overdue", overdueMonths: 1, firstOverdueMonth: 3 })
      expect(pdtpSheetActivityStatus({ ...activity, pendingMonthlyExecuted: at({ 3: 1 }) }, period, context))
        .toEqual({ status: "pending", overdueMonths: 0, firstOverdueMonth: null })
    })

    it("vista agregada: el peor caso de las faenas, no la suma", () => {
      const activity = {
        // Sumadas, las dos faenas "cubren" marzo: la agregación ingenua diría pendiente.
        effectiveMonthlyPlanned: at({ 3: 2, 5: 2 }),
        effectiveMonthlyExecuted: at({ 3: 1 }),
        monthlyNotPerformed: zeros(),
        worksiteSummaries: [
          { status: "pending" as const, overdueMonths: 0 },
          { status: "overdue" as const, overdueMonths: 2 },
        ],
      }
      expect(pdtpSheetActivityStatus(activity, period, context)).toEqual({ status: "overdue", overdueMonths: 2, firstOverdueMonth: null })
    })
  })

  it("pdtpPeriodFromChileDate lee el día chileno AAAA-MM-DD", () => {
    expect(pdtpPeriodFromChileDate("2026-05-09")).toEqual({ year: 2026, month: 5, week: 2 })
    expect(pdtpPeriodFromChileDate("2026-05-31")).toEqual({ year: 2026, month: 5, week: 4 })
    expect(pdtpPeriodFromChileDate("")).toBeNull()
  })
})

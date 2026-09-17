import { describe, expect, it } from "vitest"
import { DEFAULT_SCHEDULE_HORIZON, derivePdtpScheduleSource, deriveScheduleHorizon, describePdtpRecurrence, describePdtpRecurrenceImpact, diffScheduleCells, projectRecurrenceToLegacySchedule, recurrenceRulesEqual, scheduleCellsFingerprint } from "@/lib/services/pdtp/recurrence"
import { pdtpRecurrenceRuleSchema } from "@/lib/validation/prevention-module/pdtp"

describe("PDTP recurrence rules", () => {
  it("projects a monthly rule without exposing the matrix as authoring input", () => {
    const cells = projectRecurrenceToLegacySchedule({
      frequency: "monthly",
      interval: 1,
      plannedQuantity: 2,
      weekOfMonth: 2,
    })

    expect(cells).toHaveLength(12)
    expect(cells[0]).toEqual({ month: 1, week: 2, plannedQuantity: 2 })
    expect(cells[11]).toEqual({ month: 12, week: 2, plannedQuantity: 2 })
    expect(describePdtpRecurrence({ frequency: "monthly", interval: 1, plannedQuantity: 2, weekOfMonth: 2 }))
      .toContain("Genera 12 obligación(es)")
  })

  it("supports quarterly, annual and selected-month rules", () => {
    expect(projectRecurrenceToLegacySchedule({ frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }).map((cell) => cell.month))
      .toEqual([1, 4, 7, 10])
    expect(projectRecurrenceToLegacySchedule({ frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 3 }))
      .toEqual([{ month: 1, week: 3, plannedQuantity: 1 }])
    expect(projectRecurrenceToLegacySchedule({ frequency: "custom", interval: 1, plannedQuantity: 1, months: [12, 3, 3, 8], weekOfMonth: 4 }).map((cell) => cell.month))
      .toEqual([3, 8, 12])
  })

  it("rejects a custom recurrence without selected months", () => {
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom" }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom", months: [] }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom", months: [3] }).success).toBe(true)
  })

  it("`weeks` es opcional; ausente no aparece en la salida parseada (retrocompatible)", () => {
    const result = pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 2 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.weeks).toBeUndefined()
      expect("weeks" in result.data).toBe(false)
    }
  })

  it("`weeks` se normaliza a único y ordenado, y rechaza fuera de 1..4 o vacío", () => {
    const result = pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 1, weeks: [3, 1, 3] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.weeks).toEqual([1, 3])

    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 1, weeks: [] }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 1, weeks: [0] }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 1, weeks: [5] }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "monthly", weekOfMonth: 1, weeks: [1, 2, 3, 4, 1] }).success).toBe(false)
  })

  it("applies an interval to weekly compatibility projections", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 2, plannedQuantity: 1, weekOfMonth: 1 })
    expect(cells).toHaveLength(24)
    expect(cells.slice(0, 3)).toEqual([
      { month: 1, week: 1, plannedQuantity: 1 },
      { month: 1, week: 3, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ])
  })

  it("shows the obligation impact before changing an existing recurrence", () => {
    expect(describePdtpRecurrenceImpact(
      "scheduled",
      { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      "scheduled",
      { frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
    )).toEqual({ currentCount: 12, nextCount: 4, changed: true })
  })

  it("derives the full calendar year when a program has no declared period (2026 regression)", () => {
    expect(deriveScheduleHorizon({ year: 2026 })).toEqual({ months: Array.from({ length: 12 }, (_, i) => i + 1), weeksPerMonth: 4 })
  })

  it("bounds the horizon to a partial-year period without fabricating months outside it", () => {
    const horizon = deriveScheduleHorizon({ year: 2027, periodStart: "2027-04-01", periodEnd: "2027-09-30" })
    expect(horizon.months).toEqual([4, 5, 6, 7, 8, 9])

    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(6)
    expect(cells.map((cell) => cell.month)).toEqual([4, 5, 6, 7, 8, 9])
  })

  it("respects a custom weeksPerMonth for weekly projections", () => {
    const horizon = { months: [1, 2], weeksPerMonth: 2 }
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(4)
    expect(cells.every((cell) => cell.week <= 2)).toBe(true)
  })

  it("still yields exactly 48 cells for the annual 2026 case (regression)", () => {
    const horizon = deriveScheduleHorizon({ year: 2026 })
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(48)
  })

  /**
   * RETROCOMPATIBILIDAD (Tarea 2.1): estas seis reglas representan lo que ya
   * existe hoy en `pdtp_activities.recurrence_rule` (ninguna trae `weeks`).
   * Los fingerprints de la derecha se calcularon con el código ANTES de
   * agregar `weeks`/`months` a `weekly` — son literales fijados, no
   * recalculados por este test. Si alguno cambia, este cambio rompió la
   * proyección de programas ya firmados.
   */
  it("retrocompatibilidad: reglas históricas sin `weeks` producen el mismo fingerprint que antes del cambio", () => {
    const HISTORICAL_CASES: Array<{ label: string; rule: Parameters<typeof projectRecurrenceToLegacySchedule>[0]; fingerprintBefore: string }> = [
      {
        label: "semanal (weekly, sin months)",
        rule: { frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
        fingerprintBefore: "1-1=1.00,1-2=1.00,1-3=1.00,1-4=1.00,2-1=1.00,2-2=1.00,2-3=1.00,2-4=1.00,3-1=1.00,3-2=1.00,3-3=1.00,3-4=1.00,4-1=1.00,4-2=1.00,4-3=1.00,4-4=1.00,5-1=1.00,5-2=1.00,5-3=1.00,5-4=1.00,6-1=1.00,6-2=1.00,6-3=1.00,6-4=1.00,7-1=1.00,7-2=1.00,7-3=1.00,7-4=1.00,8-1=1.00,8-2=1.00,8-3=1.00,8-4=1.00,9-1=1.00,9-2=1.00,9-3=1.00,9-4=1.00,10-1=1.00,10-2=1.00,10-3=1.00,10-4=1.00,11-1=1.00,11-2=1.00,11-3=1.00,11-4=1.00,12-1=1.00,12-2=1.00,12-3=1.00,12-4=1.00",
      },
      {
        label: "mensual en semana N (monthly, weekOfMonth=3)",
        rule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 3 },
        fingerprintBefore: "1-3=1.00,2-3=1.00,3-3=1.00,4-3=1.00,5-3=1.00,6-3=1.00,7-3=1.00,8-3=1.00,9-3=1.00,10-3=1.00,11-3=1.00,12-3=1.00",
      },
      {
        label: "trimestral (quarterly)",
        rule: { frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
        fingerprintBefore: "1-1=1.00,4-1=1.00,7-1=1.00,10-1=1.00",
      },
      {
        label: "semestral (semiannual)",
        rule: { frequency: "semiannual", interval: 1, plannedQuantity: 1, weekOfMonth: 2 },
        fingerprintBefore: "1-2=1.00,7-2=1.00",
      },
      {
        label: "anual (annual)",
        rule: { frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
        fingerprintBefore: "1-1=1.00",
      },
      {
        label: "custom con months (personalizado)",
        rule: { frequency: "custom", interval: 1, plannedQuantity: 2, months: [3, 6, 9], weekOfMonth: 2 },
        fingerprintBefore: "3-2=2.00,6-2=2.00,9-2=2.00",
      },
    ]

    for (const { rule, fingerprintBefore } of HISTORICAL_CASES) {
      const cells = projectRecurrenceToLegacySchedule(rule, DEFAULT_SCHEDULE_HORIZON)
      expect(scheduleCellsFingerprint(cells)).toBe(fingerprintBefore)
    }
  })

  it("quincenal: `{monthly, weeks:[1,3]}` proyecta 24 celdas en semanas 1 y 3", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [1, 3] })
    expect(cells).toHaveLength(24)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([1, 3]))
    expect(new Set(cells.map((cell) => cell.month)).size).toBe(12)
  })

  it("quincenal: `{monthly, weeks:[2,4]}` también proyecta 24 celdas, en semanas 2 y 4", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [2, 4] })
    expect(cells).toHaveLength(24)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([2, 4]))
  })

  it("`weeks` desordenado y con duplicados se normaliza (único, ordenado) antes de proyectar", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [3, 1, 3, 1] })
    expect(cells).toHaveLength(24)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([1, 3]))
  })

  it("campaña: `{weekly, months:[6,7]}` proyecta 8 celdas (antes, `months` se ignoraba en weekly)", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [6, 7] })
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => cell.month))).toEqual(new Set([6, 7]))
  })

  it("diario: `{weekly, plannedQuantity:5}` proyecta 48 celdas de 5", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 5, weekOfMonth: 1 })
    expect(cells).toHaveLength(48)
    expect(cells.every((cell) => cell.plannedQuantity === 5)).toBe(true)
  })

  it("mensual en semana N sigue funcionando sin `weeks` (una sola semana por mes)", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 3 })
    expect(cells).toHaveLength(12)
    expect(cells.every((cell) => cell.week === 3)).toBe(true)
  })

  it("describePdtpRecurrence describe quincenal y campaña en texto comprensible", () => {
    expect(describePdtpRecurrence({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [1, 3] }))
      .toContain("quincenal (semanas 1 y 3)")
    expect(describePdtpRecurrence({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [6, 7] }))
      .toContain("campaña de junio a julio")
    // Sin `weeks`/`months` nuevos, el texto no debe cambiar.
    expect(describePdtpRecurrence({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 }))
      .toContain("frecuencia mensual")
  })

  it("`custom` de una sola semana con meses contiguos (preset `monthly_week` con rango, Tarea 2.2) se describe como mensual con rango, no como \"en meses seleccionados\"", () => {
    // Acto 33 del Anexo A: semana 4, febrero a diciembre. El preset
    // `monthly_week` con rango de meses codifica esto como `custom` (ver
    // schedule-presets.ts) porque `monthly` no puede excluir enero — pero
    // quien firma el programa no debería leer "en meses seleccionados" para
    // lo que es, en la práctica, un mensual con rango.
    expect(describePdtpRecurrence({
      frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 4, months: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weeks: [4],
    })).toContain("mensual, semana 4 (febrero a diciembre)")

    // Un único mes también cuenta como "contiguo" (rango degenerado).
    expect(describePdtpRecurrence({
      frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 2, months: [3], weeks: [2],
    })).toContain("mensual, semana 2 (marzo)")

    // Si los meses NO son un rango corrido (selección salteada real), el
    // texto genérico de `custom` sigue siendo el correcto — no se cambia.
    expect(describePdtpRecurrence({
      frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 2, months: [3, 6, 9], weeks: [2],
    })).toContain("en meses seleccionados")

    // Con más de una semana, el caso ya cubierto (custom con weeks.length>1)
    // no cambia: sigue siendo "en meses seleccionados (semanas...)".
    expect(describePdtpRecurrence({
      frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [2, 3, 4], weeks: [1, 3],
    })).toContain("en meses seleccionados (semanas 1 y 3)")
  })

  it("`{quarterly, weeks:[1,3]}` duplica las celdas (8 en vez de 4) y el texto lo menciona, no solo `monthly`", () => {
    const rule = { frequency: "quarterly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [1, 3] }
    const cells = projectRecurrenceToLegacySchedule(rule)
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([1, 3]))
    expect(describePdtpRecurrence(rule)).toContain("trimestral (semanas 1 y 3)")

    // Mismo requisito para semiannual, annual y custom: el motor las admite,
    // así que el texto también debe contarlas.
    expect(describePdtpRecurrence({ frequency: "semiannual", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [2, 4] }))
      .toContain("semestral (semanas 2 y 4)")
    expect(describePdtpRecurrence({ frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [1, 2] }))
      .toContain("anual (semanas 1 y 2)")
    expect(describePdtpRecurrence({ frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3], weeks: [1, 3] }))
      .toContain("en meses seleccionados (semanas 1 y 3)")
  })

  it("documenta el colapso silencioso: `weeks:[2,4]` sobre un horizonte con weeksPerMonth=2 pierde una semana", () => {
    // Mismo recorte deliberado que ya existía para `weekOfMonth`: con menos
    // de 4 semanas por mes en el horizonte (ej. período parcial), `weeks`
    // se recorta a ese máximo y puede colapsar. Aquí `4` se recorta a `2`,
    // coincide con el `2` ya presente, y el patrón deja de ser quincenal sin
    // avisar — no es un bug de esta tarea, es la extensión del comportamiento
    // ya documentado en `resolveWeeks`.
    const horizon = { months: [1, 2, 3], weeksPerMonth: 2 }
    const cells = projectRecurrenceToLegacySchedule(
      { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1, weeks: [2, 4] },
      horizon,
    )
    expect(cells).toHaveLength(3)
    expect(cells.every((cell) => cell.week === 2)).toBe(true)
  })
})

describe("PDTP schedule source derivation", () => {
  const MONTHLY = { frequency: "monthly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 2 }

  it("recurrenceRulesEqual ignora el orden de claves y la forma numérica, pero distingue meses", () => {
    // jsonb no conserva el orden de claves ni `1` frente a `1.0`; comparar con
    // JSON.stringify daría un falso "cambió" y dispararía la re-proyección.
    expect(recurrenceRulesEqual(
      { weekOfMonth: 2, plannedQuantity: 1.0, interval: 1, frequency: "monthly" },
      MONTHLY,
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [8, 3] },
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 8] },
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 8] },
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 9] },
    )).toBe(false)
    expect(recurrenceRulesEqual(MONTHLY, { ...MONTHLY, weekOfMonth: 3 })).toBe(false)
    expect(recurrenceRulesEqual(null, null)).toBe(true)
    expect(recurrenceRulesEqual(MONTHLY, null)).toBe(false)
  })

  it("recurrenceRulesEqual compara `weeks` normalizados (único, ordenado), igual que `months`", () => {
    expect(recurrenceRulesEqual(
      { ...MONTHLY, weeks: [3, 1] },
      { ...MONTHLY, weeks: [1, 3] },
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { ...MONTHLY, weeks: [1, 1, 3] },
      { ...MONTHLY, weeks: [3, 1] },
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { ...MONTHLY, weeks: [1, 3] },
      { ...MONTHLY, weeks: [1, 4] },
    )).toBe(false)
    // Ausente se trata como arreglo vacío (mismo criterio que `months` hoy),
    // no como "usa weekOfMonth": documenta el límite conocido, no lo esconde.
    expect(recurrenceRulesEqual(
      { ...MONTHLY, weeks: undefined },
      { ...MONTHLY, weeks: [] },
    )).toBe(true)
  })

  it("scheduleCellsFingerprint ignora el orden y trata ausencia igual que cero", () => {
    const a = scheduleCellsFingerprint([
      { month: 3, week: 2, plannedQuantity: 1 },
      { month: 1, week: 1, plannedQuantity: 2 },
    ])
    const b = scheduleCellsFingerprint([
      { month: 1, week: 1, plannedQuantity: 2 },
      { month: 2, week: 4, plannedQuantity: 0 },
      { month: 3, week: 2, plannedQuantity: 1 },
    ])
    expect(a).toBe(b)
    expect(scheduleCellsFingerprint([])).toBe("")
    expect(scheduleCellsFingerprint([{ month: 1, week: 1, plannedQuantity: 0 }])).toBe("")
  })

  it("diffScheduleCells separa altas, bajas, cambios y totales planificados", () => {
    const diff = diffScheduleCells(
      [{ month: 1, week: 1, plannedQuantity: 2 }, { month: 2, week: 1, plannedQuantity: 1 }],
      [{ month: 1, week: 1, plannedQuantity: 3 }, { month: 3, week: 1, plannedQuantity: 1 }],
    )
    expect(diff.addedCells).toEqual([{ month: 3, week: 1, plannedQuantity: 1 }])
    expect(diff.removedCells).toEqual([{ month: 2, week: 1, plannedQuantity: 1 }])
    expect(diff.changedCells).toEqual([{ month: 1, week: 1, from: 2, to: 3 }])
    expect(diff.currentPlannedTotal).toBe(3)
    expect(diff.nextPlannedTotal).toBe(4)
  })

  it("derivePdtpScheduleSource distingue proyección de la regla y ajuste manual", () => {
    const horizon = DEFAULT_SCHEDULE_HORIZON
    const projected = projectRecurrenceToLegacySchedule(MONTHLY, horizon)
    const base = { scheduleMode: "scheduled" as const, recurrenceRule: MONTHLY, horizon }

    expect(derivePdtpScheduleSource({ ...base, cells: projected })).toBe("rule")
    expect(derivePdtpScheduleSource({ ...base, cells: [] })).toBe("none")
    expect(derivePdtpScheduleSource({ ...base, cells: projected.slice(1) })).toBe("manual")
    expect(derivePdtpScheduleSource({ ...base, cells: [...projected, { month: 6, week: 4, plannedQuantity: 1 }] })).toBe("manual")
    expect(derivePdtpScheduleSource({
      ...base,
      cells: projected.map((cell, index) => (index === 0 ? { ...cell, plannedQuantity: 5 } : cell)),
    })).toBe("manual")
    // Celdas heredadas de la importación: no hay regla que las explique.
    expect(derivePdtpScheduleSource({ ...base, recurrenceRule: null, cells: projected })).toBe("manual")
    expect(derivePdtpScheduleSource({ ...base, scheduleMode: "on_demand", cells: projected })).toBe("manual")
  })

  it("el horizonte forma parte del criterio: las mismas celdas son regla o manual según el período", () => {
    const partial = deriveScheduleHorizon({ year: 2026, periodStart: "2026-04-01", periodEnd: "2026-09-30" })
    const cells = projectRecurrenceToLegacySchedule(MONTHLY, partial)
    expect(cells).toHaveLength(6)

    expect(derivePdtpScheduleSource({ cells, scheduleMode: "scheduled", recurrenceRule: MONTHLY, horizon: partial })).toBe("rule")
    expect(derivePdtpScheduleSource({ cells, scheduleMode: "scheduled", recurrenceRule: MONTHLY, horizon: DEFAULT_SCHEDULE_HORIZON })).toBe("manual")
  })
})

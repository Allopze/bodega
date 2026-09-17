import { describe, expect, it } from "vitest"
import { DEFAULT_SCHEDULE_HORIZON, projectRecurrenceToLegacySchedule, scheduleCellsFingerprint } from "./recurrence"
import { PDTP_SCHEDULE_PRESETS, presetToCells, presetToRule, type PdtpSchedulePresetKey, type PdtpSchedulePresetParams } from "./schedule-presets"

describe("PDTP_SCHEDULE_PRESETS", () => {
  it("declara las 8 llaves del brief con etiqueta y needs no vacíos salvo los presets sin parámetros obligatorios", () => {
    expect(PDTP_SCHEDULE_PRESETS.map((preset) => preset.key)).toEqual([
      "weekly", "daily", "monthly_week", "biweekly_13", "biweekly_24", "quarterly", "campaign", "punctual",
    ])
    for (const preset of PDTP_SCHEDULE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("presetToRule", () => {
  it("devuelve null para punctual: no hay regla, es una lista de celdas elegidas a mano", () => {
    expect(presetToRule("punctual", { cells: [{ month: 1, week: 1 }] })).toBeNull()
  })

  it("todo preset salvo punctual devuelve una regla", () => {
    const nonPunctual = PDTP_SCHEDULE_PRESETS.filter((preset) => preset.key !== "punctual")
    for (const preset of nonPunctual) {
      expect(presetToRule(preset.key, { weekOfMonth: 2, monthFrom: 3, monthTo: 6, plannedQuantity: 2 })).not.toBeNull()
    }
  })
})

describe("presetToCells reproduce los patrones reales del Excel (Anexo A)", () => {
  it("actividad 37: charlas quincenales semanas 2 y 4, todo el año → 24 celdas", () => {
    const cells = presetToCells("biweekly_24", {}, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(24)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([2, 4]))
    expect(new Set(cells.map((cell) => cell.month)).size).toBe(12)
  })

  it("actividad 88: campaña de seguridad vial, junio y julio → 8 celdas", () => {
    const cells = presetToCells("campaign", { monthFrom: 6, monthTo: 7 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => cell.month))).toEqual(new Set([6, 7]))
  })

  it("actividad 38: diálogos diarios, 5 por semana todo el año → 48 celdas, 240 ocurrencias", () => {
    const cells = presetToCells("daily", { plannedQuantity: 5 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(48)
    expect(cells.every((cell) => cell.plannedQuantity === 5)).toBe(true)
    const occurrences = cells.reduce((sum, cell) => sum + cell.plannedQuantity, 0)
    expect(occurrences).toBe(240)
  })

  it("actividad 33: mensual semana 4, de febrero a diciembre → 11 celdas", () => {
    const cells = presetToCells("monthly_week", { weekOfMonth: 4, monthFrom: 2, monthTo: 12 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(11)
    expect(cells.every((cell) => cell.week === 4)).toBe(true)
    expect(new Set(cells.map((cell) => cell.month))).toEqual(new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
  })
})

describe("presetToCells: otros presets con regla", () => {
  it("weekly: una vez por semana, todo el año → 48 celdas de 1", () => {
    const cells = presetToCells("weekly", {}, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(48)
    expect(cells.every((cell) => cell.plannedQuantity === 1)).toBe(true)
  })

  it("monthly_week sin monthFrom/monthTo cubre los 12 meses (sin restricción de rango)", () => {
    const cells = presetToCells("monthly_week", { weekOfMonth: 3 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(12)
    expect(cells.every((cell) => cell.week === 3)).toBe(true)
  })

  it("biweekly_13: semanas 1 y 3, todo el año → 24 celdas", () => {
    const cells = presetToCells("biweekly_13", {}, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(24)
    expect(new Set(cells.map((cell) => cell.week))).toEqual(new Set([1, 3]))
  })

  it("quarterly: 4 celdas (enero, abril, julio, octubre)", () => {
    const cells = presetToCells("quarterly", {}, DEFAULT_SCHEDULE_HORIZON)
    expect(cells.map((cell) => cell.month)).toEqual([1, 4, 7, 10])
  })

  it("campaign con monthFrom > monthTo no colapsa a cero: intercambia el rango", () => {
    const cells = presetToCells("campaign", { monthFrom: 7, monthTo: 6 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => cell.month))).toEqual(new Set([6, 7]))
  })
})

describe("punctual", () => {
  it("presetToCells devuelve exactamente las celdas dadas, con la cantidad planificada uniforme", () => {
    const cells = presetToCells(
      "punctual",
      { cells: [{ month: 3, week: 2 }, { month: 9, week: 1 }], plannedQuantity: 2 },
      DEFAULT_SCHEDULE_HORIZON,
    )
    expect(cells).toEqual([
      { month: 3, week: 2, plannedQuantity: 2 },
      { month: 9, week: 1, plannedQuantity: 2 },
    ])
  })

  it("sin plannedQuantity, asume 1", () => {
    const cells = presetToCells("punctual", { cells: [{ month: 1, week: 1 }] }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toEqual([{ month: 1, week: 1, plannedQuantity: 1 }])
  })

  it("sin cells, no produce nada", () => {
    expect(presetToCells("punctual", {}, DEFAULT_SCHEDULE_HORIZON)).toEqual([])
  })

  it("filtra al horizonte: una celda puntual fuera del período declarado no se cuela (período parcial)", () => {
    const partialHorizon = { months: [4, 5, 6], weeksPerMonth: 4 }
    const cells = presetToCells(
      "punctual",
      { cells: [{ month: 4, week: 1 }, { month: 12, week: 1 }] },
      partialHorizon,
    )
    expect(cells).toEqual([{ month: 4, week: 1, plannedQuantity: 1 }])
  })

  it("filtra al horizonte: una celda puntual en una semana fuera de weeksPerMonth no se cuela", () => {
    const partialHorizon = { months: [1, 2], weeksPerMonth: 2 }
    const cells = presetToCells(
      "punctual",
      { cells: [{ month: 1, week: 2 }, { month: 1, week: 4 }] },
      partialHorizon,
    )
    expect(cells).toEqual([{ month: 1, week: 2, plannedQuantity: 1 }])
  })

  it("plannedQuantity negativa se clampea a 0, igual que projectRecurrenceToLegacySchedule hace para todo preset con regla", () => {
    const cells = presetToCells(
      "punctual",
      { cells: [{ month: 1, week: 1 }], plannedQuantity: -5 },
      DEFAULT_SCHEDULE_HORIZON,
    )
    expect(cells).toEqual([{ month: 1, week: 1, plannedQuantity: 0 }])
  })
})

describe("equivalencia obligatoria: presetToCells === projectRecurrenceToLegacySchedule(presetToRule(...))", () => {
  const CASES: Array<{ key: PdtpSchedulePresetKey; params: PdtpSchedulePresetParams }> = [
    { key: "weekly", params: {} },
    { key: "weekly", params: { plannedQuantity: 3 } },
    { key: "daily", params: { plannedQuantity: 5 } },
    { key: "monthly_week", params: { weekOfMonth: 2 } },
    { key: "monthly_week", params: { weekOfMonth: 4, monthFrom: 2, monthTo: 12 } },
    { key: "biweekly_13", params: {} },
    { key: "biweekly_24", params: { plannedQuantity: 2 } },
    { key: "quarterly", params: { weekOfMonth: 2 } },
    { key: "campaign", params: { monthFrom: 6, monthTo: 7 } },
  ]

  for (const { key, params } of CASES) {
    it(`preset "${key}" con params ${JSON.stringify(params)} no diverge de proyectar su propia regla`, () => {
      const rule = presetToRule(key, params)
      expect(rule).not.toBeNull()
      const viaPreset = presetToCells(key, params, DEFAULT_SCHEDULE_HORIZON)
      const viaRule = projectRecurrenceToLegacySchedule(rule!, DEFAULT_SCHEDULE_HORIZON)
      expect(scheduleCellsFingerprint(viaPreset)).toBe(scheduleCellsFingerprint(viaRule))
      expect(viaPreset).toEqual(viaRule)
    })
  }

  it("también coincide sobre un horizonte de período parcial (no solo el año completo)", () => {
    const partialHorizon = { months: [4, 5, 6, 7, 8, 9], weeksPerMonth: 4 }
    const rule = presetToRule("biweekly_24", {})
    expect(rule).not.toBeNull()
    expect(presetToCells("biweekly_24", {}, partialHorizon)).toEqual(
      projectRecurrenceToLegacySchedule(rule!, partialHorizon),
    )
  })
})

describe("trampa documentada de resolveWeeks: horizonte con weeksPerMonth reducido colapsa un quincenal", () => {
  it("biweekly_24 (semanas 2 y 4) sobre weeksPerMonth=2 pierde la semana 4 (se recorta a 2 y se deduplica)", () => {
    // Mismo comportamiento silencioso documentado en el JSDoc de `resolveWeeks`
    // (recurrence.ts): un programa de período parcial que declare menos de 4
    // semanas por mes puede colapsar un preset quincenal a una sola semana
    // efectiva. Este módulo no lo corrige — lo hereda de
    // `projectRecurrenceToLegacySchedule` a propósito, para no duplicar esa
    // lógica — y este test deja el efecto visible y cubierto.
    const horizon = { months: [1, 2, 3], weeksPerMonth: 2 }
    const cells = presetToCells("biweekly_24", {}, horizon)
    expect(cells).toHaveLength(3)
    expect(cells.every((cell) => cell.week === 2)).toBe(true)
  })

  it("biweekly_13 (semanas 1 y 3) corre el mismo riesgo: con weeksPerMonth=1 ambas semanas colapsan a 1", () => {
    // `weeks:[1,3]` sobrevive intacto a weeksPerMonth=2 (1→1, 3→2, siguen
    // siendo distintas), pero con weeksPerMonth=1 —un período aún más
    // acotado— ambas se recortan a 1 y el `Set` las deduplica: el mismo
    // colapso silencioso que `biweekly_24`, solo que requiere un horizonte
    // más chico para manifestarse en este preset en particular.
    const horizon = { months: [1, 2, 3], weeksPerMonth: 1 }
    const cells = presetToCells("biweekly_13", {}, horizon)
    expect(cells).toHaveLength(3)
    expect(cells.every((cell) => cell.week === 1)).toBe(true)
  })
})

describe("weekOfMonth fuera de 1..4 se clampea en silencio (monthly_week, quarterly)", () => {
  it("0 se clampea a 1, 5 se clampea a 4, -3 se clampea a 1", () => {
    expect(presetToRule("monthly_week", { weekOfMonth: 0 })?.weekOfMonth).toBe(1)
    expect(presetToRule("monthly_week", { weekOfMonth: 5 })?.weekOfMonth).toBe(4)
    expect(presetToRule("monthly_week", { weekOfMonth: -3 })?.weekOfMonth).toBe(1)
    expect(presetToRule("quarterly", { weekOfMonth: 5 })?.weekOfMonth).toBe(4)
  })

  it("el clamp se refleja en las celdas proyectadas, no solo en la regla", () => {
    const cells = presetToCells("monthly_week", { weekOfMonth: 5 }, DEFAULT_SCHEDULE_HORIZON)
    expect(cells).toHaveLength(12)
    expect(cells.every((cell) => cell.week === 4)).toBe(true)
  })
})

describe("llave de preset desconocida", () => {
  it("presetToRule y presetToCells no revientan; devuelven null/[] (la tarea de importación les pasará datos externos)", () => {
    const bogusKey = "no_existe" as PdtpSchedulePresetKey
    expect(presetToRule(bogusKey, {})).toBeNull()
    expect(presetToCells(bogusKey, {}, DEFAULT_SCHEDULE_HORIZON)).toEqual([])
  })
})

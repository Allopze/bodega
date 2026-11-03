import { describe, expect, it } from "vitest"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import {
  buildSlotCalendar,
  deriveMonthCell,
  monthPhase,
  parseCalendarMonth,
  summarizeSlotCalendar,
  slotCalendarDataTable,
  type SlotCalendarSlot,
} from "./slot-compliance-calendar"

// Hoy: junio de 2026, semana 2.
const TODAY: PdtpPeriod = { year: 2026, month: 6, week: 2 }

function slot(month: number | null, status: SlotCalendarSlot["status"], extra: Partial<SlotCalendarSlot> = {}): SlotCalendarSlot {
  return { rowId: "faena-a", month, week: month === null ? null : 2, status, ...extra }
}

function cell(month: number, slots: SlotCalendarSlot[], extra: { year?: number; activation?: PdtpPeriod | null; today?: PdtpPeriod } = {}) {
  return deriveMonthCell(slots, {
    year: extra.year ?? 2026,
    month,
    today: extra.today ?? TODAY,
    activation: extra.activation ?? null,
  })
}

describe("monthPhase", () => {
  it("un mes vence cuando termina: el mes en curso todavía no", () => {
    expect(monthPhase(2026, 5, TODAY)).toBe("past")
    expect(monthPhase(2026, 6, TODAY)).toBe("current")
    expect(monthPhase(2026, 7, TODAY)).toBe("future")
  })

  it("un año ya terminado está vencido entero y uno futuro no lo está en nada", () => {
    expect(monthPhase(2025, 12, TODAY)).toBe("past")
    expect(monthPhase(2025, 1, TODAY)).toBe("past")
    expect(monthPhase(2027, 1, TODAY)).toBe("future")
    expect(monthPhase(2027, 12, TODAY)).toBe("future")
  })
})

describe("deriveMonthCell — estado de un mes", () => {
  it("todo hecho en un mes pasado: cumplido", () => {
    const result = cell(3, [slot(3, "completed"), slot(3, "completed")])
    expect(result).toMatchObject({ status: "ok", exigible: 2, completed: 2, missed: 0 })
    expect(result.detail).toBe("2 de 2 hechas")
  })

  it("una sola casilla hecha se dice en singular", () => {
    expect(cell(3, [slot(3, "completed")]).detail).toBe("1 de 1 hecha")
  })

  it("algunas hechas en un mes pasado: parcial, y lo que falta cuenta como atraso", () => {
    const result = cell(3, [slot(3, "completed"), slot(3, "pending")])
    expect(result).toMatchObject({ status: "partial", exigible: 2, completed: 1, missed: 1 })
  })

  it("ninguna hecha y el mes ya pasó: vencido sin cumplir", () => {
    const result = cell(3, [slot(3, "pending"), slot(3, "pending")])
    expect(result).toMatchObject({ status: "missing", exigible: 2, completed: 0, missed: 2 })
    expect(result.detail).toBe("0 de 2 hechas")
  })

  it("una casilla declarada «no hecha» es incumplimiento aunque su mes no haya terminado", () => {
    expect(cell(6, [slot(6, "not_completed")])).toMatchObject({ status: "missing", missed: 1 })
    expect(cell(9, [slot(9, "not_completed")])).toMatchObject({ status: "missing", missed: 1 })
  })

  it("mes en curso sin nada hecho: pendiente, no vencido, y se dice que está en curso", () => {
    const result = cell(6, [slot(6, "pending")])
    expect(result).toMatchObject({ status: "upcoming", missed: 0 })
    expect(result.detail).toBe("0 de 1 hecha · mes en curso")
  })

  it("mes futuro sin nada hecho: pendiente", () => {
    expect(cell(9, [slot(9, "pending"), slot(9, "pending")])).toMatchObject({ status: "upcoming", missed: 0 })
  })

  it("un mes futuro adelantado es parcial o cumplido según cuánto se hizo", () => {
    expect(cell(9, [slot(9, "completed"), slot(9, "pending")])).toMatchObject({ status: "partial", missed: 0 })
    expect(cell(9, [slot(9, "completed"), slot(9, "completed")])).toMatchObject({ status: "ok" })
  })

  it("mes en curso con algo hecho y algo pendiente: parcial, sin atraso todavía", () => {
    expect(cell(6, [slot(6, "completed"), slot(6, "pending")])).toMatchObject({ status: "partial", missed: 0 })
  })

  it("sin ninguna actividad programada en el mes: no exigible", () => {
    const result = cell(4, [])
    expect(result).toMatchObject({ status: "na", exigible: 0 })
    expect(result.detail).toBe("sin actividad programada")
  })

  it("todo «no aplica»: no exigible y no cuenta ni como cumplido ni como atraso", () => {
    const result = cell(3, [slot(3, "not_applicable"), slot(3, "not_applicable")])
    expect(result).toMatchObject({ status: "na", exigible: 0, missed: 0 })
    expect(result.detail).toBe("no aplica")
  })

  it("«no aplica» sale del denominador: dos hechas y una que no aplica es cumplido", () => {
    const result = cell(3, [slot(3, "completed"), slot(3, "completed"), slot(3, "not_applicable")])
    expect(result).toMatchObject({ status: "ok", exigible: 2, completed: 2 })
  })
})

describe("deriveMonthCell — activación del programa", () => {
  const activation: PdtpPeriod = { year: 2026, month: 3, week: 3 }

  it("una casilla anterior a la activación no se exige: el mes queda no exigible", () => {
    const result = cell(2, [slot(2, "pending")], { activation })
    expect(result).toMatchObject({ status: "na", exigible: 0, missed: 0 })
    expect(result.detail).toBe("anterior a la activación del programa")
  })

  it("el corte es por semana: la semana de activación ya se exige, la anterior no", () => {
    const before = cell(3, [{ ...slot(3, "pending"), week: 2 }], { activation })
    const onTheWeek = cell(3, [{ ...slot(3, "pending"), week: 3 }], { activation })
    expect(before.status).toBe("na")
    expect(onTheWeek.status).toBe("missing")
  })

  it("lo hecho antes de la activación cuenta: se hizo aunque no se exigiera", () => {
    expect(cell(2, [slot(2, "completed")], { activation })).toMatchObject({ status: "ok", exigible: 1, completed: 1 })
  })

  it("una casilla «no hecha» anterior a la activación tampoco se exige", () => {
    expect(cell(2, [slot(2, "not_completed")], { activation })).toMatchObject({ status: "na", missed: 0 })
  })

  it("sin programa activo (activación nula) todo se exige", () => {
    expect(cell(2, [slot(2, "pending")], { activation: null })).toMatchObject({ status: "missing" })
  })
})

describe("deriveMonthCell — años distintos al actual", () => {
  it("un año ya cerrado: lo pendiente es incumplimiento en los doce meses", () => {
    expect(cell(1, [slot(1, "pending")], { year: 2025 })).toMatchObject({ status: "missing" })
    expect(cell(12, [slot(12, "pending")], { year: 2025 })).toMatchObject({ status: "missing" })
  })

  it("un año que no empieza: todo es pendiente", () => {
    expect(cell(1, [slot(1, "pending")], { year: 2027 })).toMatchObject({ status: "upcoming" })
  })
})

describe("deriveMonthCell — desglose por tipo", () => {
  it("cuando el mes mezcla controles y envíos, el detalle los separa", () => {
    const result = cell(3, [
      slot(3, "completed", { group: "Controles" }),
      slot(3, "pending", { group: "Envíos" }),
    ])
    expect(result.status).toBe("partial")
    expect(result.detail).toBe("Controles 1 de 1 · Envíos 0 de 1")
  })

  it("un tipo que no aplica no aparece en el desglose", () => {
    const result = cell(3, [
      slot(3, "completed", { group: "Controles" }),
      slot(3, "not_applicable", { group: "Envíos" }),
    ])
    expect(result.status).toBe("ok")
    expect(result.detail).toBe("1 de 1 hecha")
  })
})

describe("buildSlotCalendar", () => {
  const rows = [
    { id: "b", label: "Faena Beta" },
    { id: "a", label: "Faena Alfa" },
    { id: "z", label: "Sin casillas" },
  ]

  it("arma doce celdas por faena, ordena por nombre y omite las faenas sin casillas", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows,
      slots: [
        { rowId: "a", month: 1, week: 2, status: "completed" },
        { rowId: "a", month: 2, week: 2, status: "pending" },
        { rowId: "b", month: 1, week: 2, status: "pending" },
      ],
    })
    expect(calendar.rows.map((row) => row.id)).toEqual(["a", "b"])
    expect(calendar.rows[0]!.cells).toHaveLength(12)
    expect(calendar.rows[0]!.cells.map((c) => c.status).slice(0, 4)).toEqual(["ok", "missing", "na", "na"])
    expect(calendar.rows[0]!.cells[0]!.month).toBe(1)
  })

  it("cuenta meses con atraso y actividades por faena", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows,
      slots: [
        { rowId: "a", month: 1, week: 2, status: "completed" },
        { rowId: "a", month: 2, week: 2, status: "pending" },
        { rowId: "a", month: 3, week: 2, status: "not_completed" },
        { rowId: "a", month: 4, week: 2, status: "completed" },
        { rowId: "a", month: 4, week: 2, status: "pending" },
        { rowId: "a", month: 8, week: 2, status: "pending" },
      ],
    })
    const alfa = calendar.rows[0]!
    expect(alfa.overdueMonths).toBe(3)
    expect(alfa).toMatchObject({ exigible: 6, completed: 2, missed: 3 })
  })

  it("las casillas sin mes o sin semana no entran al calendario y se cuentan aparte", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows,
      slots: [
        { rowId: "a", month: 1, week: 2, status: "completed" },
        { rowId: "a", month: null, week: null, status: "pending" },
        { rowId: "a", month: 5, week: null, status: "pending" },
        { rowId: "a", month: null, week: null, status: "not_applicable" },
      ],
    })
    expect(calendar.unscheduled).toBe(2)
    expect(calendar.rows[0]!.cells[4]!.status).toBe("na")
  })

  it("aplica la activación de cada faena, no una sola para todas", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows,
      slots: [
        { rowId: "a", month: 3, week: 2, status: "pending" },
        { rowId: "b", month: 3, week: 2, status: "pending" },
      ],
      activationByRow: new Map<string, PdtpPeriod | null>([
        ["a", null],
        ["b", { year: 2026, month: 5, week: 1 }],
      ]),
    })
    expect(calendar.rows[0]!.cells[2]!.status).toBe("missing")
    expect(calendar.rows[1]!.cells[2]!.status).toBe("na")
  })

  it("ignora casillas de una faena que no está entre las filas pedidas", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows,
      slots: [{ rowId: "otra", month: 1, week: 2, status: "pending" }],
    })
    expect(calendar.rows).toEqual([])
  })
})

describe("summarizeSlotCalendar", () => {
  const noun = { singular: "faena", plural: "faenas" }
  const build = (slots: SlotCalendarSlot[], rowLabels: Array<[string, string]>) => buildSlotCalendar({
    year: 2026,
    today: TODAY,
    rows: rowLabels.map(([id, label]) => ({ id, label })),
    slots,
  })

  it("nombra la faena más atrasada y los meses que lleva", () => {
    const calendar = build([
      { rowId: "a", month: 1, week: 2, status: "pending" },
      { rowId: "b", month: 1, week: 2, status: "pending" },
      { rowId: "b", month: 2, week: 2, status: "pending" },
      { rowId: "b", month: 3, week: 2, status: "pending" },
      { rowId: "c", month: 1, week: 2, status: "completed" },
    ], [["a", "Faena Alfa"], ["b", "Faena Beta"], ["c", "Faena Gamma"]])
    expect(summarizeSlotCalendar(calendar.rows, { noun })).toBe(
      "2 de 3 faenas tienen meses vencidos sin cumplir; la más atrasada es Faena Beta con 3 meses.",
    )
  })

  it("una sola faena con un solo mes, en singular", () => {
    const calendar = build([
      { rowId: "a", month: 1, week: 2, status: "pending" },
      { rowId: "b", month: 1, week: 2, status: "completed" },
    ], [["a", "Faena Alfa"], ["b", "Faena Beta"]])
    expect(summarizeSlotCalendar(calendar.rows, { noun })).toBe(
      "1 de 2 faenas tiene meses vencidos sin cumplir; la más atrasada es Faena Alfa con 1 mes.",
    )
  })

  it("si varias empatan en el mayor atraso no elige una al azar", () => {
    const calendar = build([
      { rowId: "a", month: 1, week: 2, status: "pending" },
      { rowId: "a", month: 2, week: 2, status: "pending" },
      { rowId: "b", month: 1, week: 2, status: "pending" },
      { rowId: "b", month: 2, week: 2, status: "pending" },
      { rowId: "c", month: 1, week: 2, status: "pending" },
    ], [["a", "Faena Alfa"], ["b", "Faena Beta"], ["c", "Faena Gamma"]])
    expect(summarizeSlotCalendar(calendar.rows, { noun })).toBe(
      "3 de 3 faenas tienen meses vencidos sin cumplir; el mayor atraso es de 2 meses y lo comparten 2 faenas.",
    )
  })

  it("sin atraso, lo dice", () => {
    const calendar = build([
      { rowId: "a", month: 1, week: 2, status: "completed" },
      { rowId: "a", month: 9, week: 2, status: "pending" },
    ], [["a", "Faena Alfa"]])
    expect(summarizeSlotCalendar(calendar.rows, { noun })).toBe("Ninguna faena tiene meses vencidos sin cumplir.")
  })

  it("sin nada exigible no afirma un cumplimiento que no se midió", () => {
    const calendar = build([{ rowId: "a", month: 1, week: 2, status: "not_applicable" }], [["a", "Faena Alfa"]])
    expect(summarizeSlotCalendar(calendar.rows, { noun })).toBe("Todavía no hay actividades exigibles en el programa.")
  })

  it("sin filas devuelve texto vacío", () => {
    expect(summarizeSlotCalendar([], { noun })).toBe("")
  })
})

describe("slotCalendarDataTable", () => {
  it("entrega una fila por faena con las cifras que el calendario sólo insinúa", () => {
    const calendar = buildSlotCalendar({
      year: 2026,
      today: TODAY,
      rows: [{ id: "a", label: "Faena Alfa" }],
      slots: [
        { rowId: "a", month: 1, week: 2, status: "completed" },
        { rowId: "a", month: 2, week: 2, status: "pending" },
        { rowId: "a", month: 9, week: 2, status: "pending" },
      ],
    })
    const table = slotCalendarDataTable(calendar.rows, "Faena")
    expect(table.headers).toEqual(["Faena", "Actividades exigibles", "Hechas", "Vencidas sin hacer", "Meses con atraso"])
    expect(table.rows).toEqual([["Faena Alfa", 3, 1, 1, 1]])
  })
})

describe("parseCalendarMonth", () => {
  it("acepta un mes del 1 al 12", () => {
    expect(parseCalendarMonth("1")).toBe(1)
    expect(parseCalendarMonth("12")).toBe(12)
    expect(parseCalendarMonth(" 7 ")).toBe(7)
    expect(parseCalendarMonth(["3", "9"])).toBe(3)
  })

  it("todo lo demás es «sin filtro de mes»", () => {
    for (const value of [undefined, "", "0", "13", "-1", "abril", "3.5", "03x", [], ["x"]]) {
      expect(parseCalendarMonth(value as string | string[] | undefined)).toBeNull()
    }
  })
})

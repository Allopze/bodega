import { describe, expect, it } from "vitest"
import { hourKeyId } from "./hours"
import { isHourKnown, rankOperators, SHIFT_STATUS_LABEL, summarizeEquipmentDay, summarizeShift, type VehicleTelemetry } from "./calc"
import type { HourKey, HourSeconds, PlainDate, ShiftWindow } from "./types"

const M = 60
const H = 3600
const TARGET = 0.3
/** Una consulta posterior a todo lo que ocurre en los días de prueba. */
const LATE = "2026-12-31T00:00:00Z"

function emptyTele(over: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return { linked: true, hours: new Map(), segmentsFetchedAt: new Map(), lastReportDay: null, signalLost: false, ...over }
}

/** Telemetría con los `days` consultados después de cualquier hora, de un equipo que sigue transmitiendo. */
function teleFor(days: PlainDate[], hours: Array<[HourKey, Partial<HourSeconds>]>, over: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  const tele = emptyTele({
    segmentsFetchedAt: new Map(days.map((day) => [day, LATE])),
    lastReportDay: days[days.length - 1] ?? null,
    signalLost: false,
    ...over,
  })
  for (const [key, seconds] of hours) tele.hours.set(hourKeyId(key), { idle: 0, working: 0, running: 0, ...seconds })
  return tele
}

const morning: ShiftWindow = { shiftDate: "2026-11-09", startHour: 6, endHour: 14 }
const night: ShiftWindow = { shiftDate: "2026-11-08", startHour: 22, endHour: 6 }

describe("isHourKnown", () => {
  // La hora 9 del 2026-11-09 termina a las 10:00 locales (UTC-3) = 13:00 UTC; con el margen, 14:00 UTC.
  const key: HourKey = { day: "2026-11-09", hour: 9 }
  it("sin constancia no es conocida", () => {
    expect(isHourKnown(key, undefined)).toBe(false)
  })
  it("consultada antes del fin de hora + 1 h no es conocida", () => {
    expect(isHourKnown(key, "2026-11-09T13:30:00Z")).toBe(false)
    expect(isHourKnown(key, "2026-11-09T13:59:59Z")).toBe(false)
  })
  it("consultada desde el fin de hora + 1 h sí es conocida", () => {
    expect(isHourKnown(key, "2026-11-09T14:00:00Z")).toBe(true)
    expect(isHourKnown(key, "2026-11-10T00:00:00Z")).toBe(true)
  })
  it("una constancia ilegible no cuenta", () => {
    expect(isHourKnown(key, "no es fecha")).toBe(false)
  })
})

describe("SHIFT_STATUS_LABEL", () => {
  it("usa los rótulos del diseño", () => {
    expect(SHIFT_STATUS_LABEL).toEqual({
      sin_telemetria: "Sin telemetría",
      pendiente: "Pendiente de datos",
      sin_senal: "Sin señal",
      sin_uso: "Sin uso",
      sin_dato_ralenti: "Sin dato de ralentí",
      sobre_meta: "Sobre meta",
      en_meta: "En meta",
    })
  })
})

describe("summarizeShift", () => {
  const day = "2026-11-09"
  it("1 h de ralentí y 3 de trabajo da 25 % y queda en meta", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 1 * H }], [{ day, hour: 7 }, { working: 3 * H }]])
    const summary = summarizeShift(morning, tele, TARGET)
    expect(summary.idleHours).toBeCloseTo(1)
    expect(summary.workingHours).toBeCloseTo(3)
    expect(summary.engineHours).toBeCloseTo(4)
    expect(summary.idlePct).toBeCloseTo(0.25)
    expect(summary.status).toBe("en_meta")
  })

  it("2 h de ralentí y 2 de trabajo da 50 % y queda sobre la meta", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 2 * H }], [{ day, hour: 7 }, { working: 2 * H }]])
    const summary = summarizeShift(morning, tele, TARGET)
    expect(summary.idlePct).toBeCloseTo(0.5)
    expect(summary.status).toBe("sobre_meta")
  })

  it("exactamente la meta está en meta", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 18 * M, working: 42 * M }]])
    expect(summarizeShift(morning, tele, 0.3).status).toBe("en_meta")
  })

  it("running suma al motor y no al porcentaje", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 1 * H, working: 3 * H, running: 4 * H }]])
    const summary = summarizeShift(morning, tele, TARGET)
    expect(summary.runningHours).toBeCloseTo(4)
    expect(summary.engineHours).toBeCloseTo(8)
    expect(summary.idlePct).toBeCloseTo(0.25)
  })

  it("una hora sin constancia deja el turno pendiente", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 1 * H, working: 3 * H }]], { segmentsFetchedAt: new Map() })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("pendiente")
  })

  it("consultado antes del fin de la última hora + 1 h queda pendiente", () => {
    // La última hora (13) termina a las 14:00 locales = 17:00 UTC; con el margen, 18:00 UTC.
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 1 * H, working: 3 * H }]], { segmentsFetchedAt: new Map([[day, "2026-11-09T17:30:00Z"]]) })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("pendiente")
    tele.segmentsFetchedAt.set(day, "2026-11-09T18:00:00Z")
    expect(summarizeShift(morning, tele, TARGET).status).toBe("en_meta")
  })

  it("una hora conocida sin entrada vale 0 s", () => {
    const tele = teleFor([day], [[{ day, hour: 9 }, { idle: 1 * H, working: 3 * H }]])
    expect(summarizeShift(morning, tele, TARGET).engineHours).toBeCloseTo(4)
  })

  it("un turno nocturno mira las constancias de cada día que toca", () => {
    const tele = teleFor(["2026-11-08", "2026-11-09"], [[{ day: "2026-11-08", hour: 23 }, { running: 2 * H }]])
    expect(summarizeShift(night, tele, TARGET).status).toBe("sin_dato_ralenti")
    tele.segmentsFetchedAt.delete("2026-11-09")
    expect(summarizeShift(night, tele, TARGET).status).toBe("pendiente")
  })

  it("0,4 h de motor es sin uso", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 12 * M, working: 12 * M }]])
    expect(summarizeShift(morning, tele, TARGET).status).toBe("sin_uso")
  })

  it("0,5 h de motor ya no es sin uso", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 6 * M, working: 24 * M }]])
    expect(summarizeShift(morning, tele, TARGET).status).toBe("en_meta")
  })

  it("motor sólo en running es sin dato de ralentí", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { running: 2 * H }]])
    const summary = summarizeShift(morning, tele, TARGET)
    expect(summary.status).toBe("sin_dato_ralenti")
    expect(summary.idlePct).toBeNull()
  })

  it("sin serie vinculada es sin telemetría, aunque falten datos", () => {
    const summary = summarizeShift(morning, emptyTele({ linked: false }), TARGET)
    expect(summary.status).toBe("sin_telemetria")
    expect(summary.engineHours).toBe(0)
    expect(summary.idlePct).toBeNull()
  })

  it("0 s de motor de un equipo que perdió la señal y no transmitió después es sin señal", () => {
    const tele = teleFor([day], [], { lastReportDay: "2026-11-01", signalLost: true })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("sin_senal")
  })

  it("0 s de motor de un equipo que transmitió después (domingo detenido) es sin uso", () => {
    // VisionLink omite los días sin uso: GR-10 el 15-nov no trae nada, pero el 16 sí transmitió.
    const tele = teleFor([day], [], { lastReportDay: "2026-11-10", signalLost: false })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("sin_uso")
  })

  it("0 s de motor de un equipo con señal perdida pero que transmitió después de ese día es sin uso", () => {
    const tele = teleFor([day], [], { lastReportDay: "2026-11-12", signalLost: true })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("sin_uso")
  })

  it("un equipo que nunca transmitió y perdió la señal es sin señal", () => {
    expect(summarizeShift(morning, teleFor([day], [], { lastReportDay: null, signalLost: true }), TARGET).status).toBe("sin_senal")
  })

  it("con motor, la señal perdida no importa", () => {
    const tele = teleFor([day], [[{ day, hour: 6 }, { idle: 1 * H, working: 3 * H }]], { lastReportDay: day, signalLost: true })
    expect(summarizeShift(morning, tele, TARGET).status).toBe("en_meta")
  })

  it("en un turno nocturno basta un día silencioso para sin señal", () => {
    const tele = teleFor(["2026-11-08", "2026-11-09"], [], { lastReportDay: "2026-11-08", signalLost: true })
    expect(summarizeShift(night, tele, TARGET).status).toBe("sin_senal")
  })
})

describe("summarizeEquipmentDay", () => {
  const day = "2026-11-09"
  const prev = "2026-11-08"
  const tele = teleFor(
    [prev, day, "2026-11-10"],
    [
      [{ day: prev, hour: 23 }, { idle: 1 * H, working: 2 * H }], // fuera del día
      [{ day, hour: 2 }, { idle: 0.5 * H, working: 1 * H, running: 0.25 * H }], // turno nocturno del día anterior
      [{ day, hour: 8 }, { idle: 1 * H, working: 2 * H }], // turno de mañana
      [{ day, hour: 13 }, { idle: 0.25 * H, working: 0.5 * H }], // turno de mañana
      [{ day, hour: 15 }, { idle: 1 * H, working: 0.5 * H, running: 0.5 * H }], // sin turno
      [{ day, hour: 23 }, { working: 0.25 * H }], // sin turno
      [{ day: "2026-11-10", hour: 1 }, { working: 5 * H }], // otro día
    ],
  )

  it("asigna al turno las horas que cubre, incluso las del turno del día anterior", () => {
    const result = summarizeEquipmentDay(day, [night, morning], tele, { outOfService: false })
    expect(result.engineHours).toBeCloseTo(7.75)
    expect(result.assignedEngineHours).toBeCloseTo(1.75 + 3 + 0.75)
    expect(result.unassignedEngineHours).toBeCloseTo(2 + 0.25)
  })

  it("identidad: asignadas + sin turno = motor del día", () => {
    const result = summarizeEquipmentDay(day, [night, morning], tele, { outOfService: false })
    expect(result.assignedEngineHours + result.unassignedEngineHours).toBeCloseTo(result.engineHours, 10)
  })

  it("identidad por tipo: las ventanas del día suman lo mismo que el equipo-día", () => {
    const result = summarizeEquipmentDay(day, [night, morning], tele, { outOfService: false })
    const windows: ShiftWindow[] = [
      { shiftDate: day, startHour: 0, endHour: 6 },
      { shiftDate: day, startHour: 6, endHour: 14 },
      { shiftDate: day, startHour: 14, endHour: 22 },
      { shiftDate: day, startHour: 22, endHour: 0 }, // 22–24 del mismo día
    ]
    const parts = windows.map((window) => summarizeShift(window, tele, TARGET))
    const sum = (pick: (part: (typeof parts)[number]) => number) => parts.reduce((total, part) => total + pick(part), 0)
    expect(result.idleHours).toBeCloseTo(sum((part) => part.idleHours), 10)
    expect(result.workingHours).toBeCloseTo(sum((part) => part.workingHours), 10)
    expect(result.runningHours).toBeCloseTo(sum((part) => part.runningHours), 10)
    expect(result.idleHours).toBeCloseTo(0.5 + 1 + 0.25 + 1)
    expect(result.idlePct).toBeCloseTo(result.idleHours / (result.idleHours + result.workingHours))
  })

  it("sin turnos todo el motor queda sin turno", () => {
    const result = summarizeEquipmentDay(day, [], tele, { outOfService: false })
    expect(result.assignedEngineHours).toBe(0)
    expect(result.unassignedEngineHours).toBeCloseTo(result.engineHours)
  })

  it("dos turnos que se pisan no cuentan dos veces", () => {
    const overlapping: ShiftWindow = { shiftDate: day, startHour: 8, endHour: 12 }
    const once = summarizeEquipmentDay(day, [morning], tele, { outOfService: false })
    const twice = summarizeEquipmentDay(day, [morning, overlapping], tele, { outOfService: false })
    expect(twice.assignedEngineHours).toBeCloseTo(once.assignedEngineHours)
  })

  it("avisa con 1 h o más de motor sin turno, salvo equipo fuera de servicio", () => {
    const loose = teleFor([day], [[{ day, hour: 15 }, { idle: 1 * H, working: 0.5 * H }]])
    expect(summarizeEquipmentDay(day, [morning], loose, { outOfService: false }).warnUnassigned).toBe(true)
    expect(summarizeEquipmentDay(day, [morning], loose, { outOfService: true }).warnUnassigned).toBe(false)
  })

  it("no avisa con menos de 1 h sin turno", () => {
    const loose = teleFor([day], [[{ day, hour: 15 }, { idle: 0.5 * H }]])
    expect(summarizeEquipmentDay(day, [morning], loose, { outOfService: false }).warnUnassigned).toBe(false)
  })

  it("1 h exacta sin turno ya avisa", () => {
    const loose = teleFor([day], [[{ day, hour: 15 }, { idle: 1 * H }]])
    expect(summarizeEquipmentDay(day, [], loose, { outOfService: false }).warnUnassigned).toBe(true)
  })

  it("señal: ok, pendiente, sin señal y sin telemetría", () => {
    expect(summarizeEquipmentDay(day, [], tele, { outOfService: false }).signal).toBe("ok")
    // La hora 23 termina a las 03:00 UTC del día siguiente: a las 20:00 UTC aún no es conocida.
    const partial = teleFor([day], [], { segmentsFetchedAt: new Map([[day, "2026-11-09T20:00:00Z"]]) })
    expect(summarizeEquipmentDay(day, [], partial, { outOfService: false }).signal).toBe("pendiente")
    const silent = teleFor([day], [], { lastReportDay: "2026-08-27", signalLost: true })
    expect(summarizeEquipmentDay(day, [], silent, { outOfService: false }).signal).toBe("sin_senal")
    expect(summarizeEquipmentDay(day, [], emptyTele({ linked: false }), { outOfService: false }).signal).toBe("sin_telemetria")
  })

  it("un día sin motor de un equipo que transmitió después es detenido (ok), no sin señal", () => {
    const parked = teleFor([day], [], { lastReportDay: "2026-11-10", signalLost: false })
    expect(summarizeEquipmentDay(day, [], parked, { outOfService: false }).signal).toBe("ok")
  })

  it("un día con motor nunca es sin señal", () => {
    const some = teleFor([day], [[{ day, hour: 9 }, { idle: 1 * H }]], { lastReportDay: day, signalLost: true })
    expect(summarizeEquipmentDay(day, [], some, { outOfService: false }).signal).toBe("ok")
  })
})

describe("rankOperators", () => {
  const day = "2026-11-09"
  function summary(hours: Partial<HourSeconds>, over: Partial<VehicleTelemetry> = {}) {
    return summarizeShift(morning, teleFor([day], [[{ day, hour: 6 }, hours]], over), TARGET)
  }

  it("pondera por horas y no promedia porcentajes", () => {
    const result = rankOperators([
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 1 * H }) }, // 50 % en 2 h
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 7 * H }) }, // 12,5 % en 8 h
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.idlePct).toBeCloseTo(2 / 10)
    expect(result.rows[0]!.shifts).toBe(2)
    expect(result.rows[0]!.overTarget).toBe(1)
    expect(result.rows[0]!.engineHours).toBeCloseTo(10)
    expect(result.rows[0]!.idleHours).toBeCloseTo(2)
    expect(result.rows[0]!.workingHours).toBeCloseTo(8)
  })

  it("ordena de menor a mayor porcentaje y numera", () => {
    const result = rankOperators([
      { operatorWorkerId: "b", operatorName: "Bruno", summary: summary({ idle: 2 * H, working: 2 * H }) },
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 3 * H }) },
    ])
    expect(result.rows.map((row) => [row.operatorName, row.rank])).toEqual([["Ana", 1], ["Bruno", 2]])
  })

  it("empata por nombre", () => {
    const result = rankOperators([
      { operatorWorkerId: "b", operatorName: "Bruno", summary: summary({ idle: 1 * H, working: 3 * H }) },
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 3 * H }) },
    ])
    expect(result.rows.map((row) => row.operatorName)).toEqual(["Ana", "Bruno"])
  })

  it("un operador sin porcentaje va al final, sin número", () => {
    const result = rankOperators([
      { operatorWorkerId: "z", operatorName: "Zoe", summary: summary({}) }, // sin uso
      { operatorWorkerId: "b", operatorName: "Bruno", summary: summary({ idle: 2 * H, working: 2 * H }) },
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 3 * H }) },
    ])
    expect(result.rows.map((row) => [row.operatorName, row.rank])).toEqual([["Ana", 1], ["Bruno", 2], ["Zoe", null]])
    expect(result.rows[2]!.shifts).toBe(1)
    expect(result.rows[2]!.idlePct).toBeNull()
  })

  it("los pendientes se cuentan pero no mueven el porcentaje", () => {
    const pending = summary({ idle: 3 * H, working: 1 * H }, { segmentsFetchedAt: new Map() })
    expect(pending.status).toBe("pendiente")
    const result = rankOperators([
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 3 * H }) },
      { operatorWorkerId: "a", operatorName: "Ana", summary: pending },
    ])
    const row = result.rows[0]!
    expect(row.pending).toBe(1)
    expect(row.shifts).toBe(2)
    expect(row.idlePct).toBeCloseTo(0.25)
    expect(row.engineHours).toBeCloseTo(4)
  })

  it("un operador sólo con turnos pendientes no tiene porcentaje", () => {
    const pending = summary({ idle: 3 * H, working: 1 * H }, { segmentsFetchedAt: new Map() })
    const result = rankOperators([{ operatorWorkerId: "a", operatorName: "Ana", summary: pending }])
    expect(result.rows[0]!.rank).toBeNull()
    expect(result.rows[0]!.idlePct).toBeNull()
    expect(result.rows[0]!.pending).toBe(1)
  })

  it("el total agrega todas las filas con la misma regla", () => {
    const result = rankOperators([
      { operatorWorkerId: "a", operatorName: "Ana", summary: summary({ idle: 1 * H, working: 3 * H }) },
      { operatorWorkerId: "b", operatorName: "Bruno", summary: summary({ idle: 2 * H, working: 2 * H }) },
      { operatorWorkerId: "c", operatorName: "Carla", summary: summary({}) },
      { operatorWorkerId: "d", operatorName: "Diego", summary: summary({ idle: 1 * H }, { segmentsFetchedAt: new Map() }) },
    ])
    expect(result.total.shifts).toBe(4)
    expect(result.total.pending).toBe(1)
    expect(result.total.overTarget).toBe(1)
    expect(result.total.idleHours).toBeCloseTo(3)
    expect(result.total.workingHours).toBeCloseTo(5)
    expect(result.total.engineHours).toBeCloseTo(8)
    expect(result.total.idlePct).toBeCloseTo(3 / 8)
  })

  it("sin filas no hay filas ni porcentaje", () => {
    const result = rankOperators([])
    expect(result.rows).toEqual([])
    expect(result.total).toEqual({ shifts: 0, engineHours: 0, workingHours: 0, idleHours: 0, idlePct: null, overTarget: 0, pending: 0 })
  })
})

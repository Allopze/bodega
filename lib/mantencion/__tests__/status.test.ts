import { describe, expect, it } from "vitest"
import {
  equipmentStatus, findDuplicatePreventive, NEXT_THRESHOLD, stateRank, WORKSHOP_UPDATE_DAYS, workshopState,
  type PreventiveRef, type StatusInput,
} from "../status"
import { MANT_EQUIPMENT_STATES, type MantReading } from "../types"

const KM = [10_000, 20_000, 40_000, 80_000, 160_000]
const HORAS = [300, 600, 900, 1_200]
const reading = (value: number, date = "2026-06-01"): MantReading => ({ value, date, source: "MP-BIO-0001" })

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return { retired: false, intervals: KM, readings: [], initial: null, lastPreventive: null, ...overrides }
}

describe("regla 6 · estado de mantención", () => {
  it("expone el umbral del 15 %", () => {
    expect(NEXT_THRESHOLD).toBe(0.15)
  })

  it("baja gana sobre todo lo demás", () => {
    expect(equipmentStatus(input({ retired: true, intervals: null, readings: [reading(5)] })).state).toBe("baja")
  })

  it("sin pauta (nula o sin intervalos), aunque tenga lecturas", () => {
    expect(equipmentStatus(input({ intervals: null, readings: [reading(5_000)] })).state).toBe("sin_pauta")
    expect(equipmentStatus(input({ intervals: [], readings: [reading(5_000)] })).state).toBe("sin_pauta")
  })

  it("sin lecturas: ni registros ni lectura inicial", () => {
    const status = equipmentStatus(input())
    expect(status).toMatchObject({ state: "sin_lecturas", currentReading: null, nextReading: null, remaining: null, nextIntervalValue: null })
  })

  it("la lectura inicial sirve cuando no hay registros", () => {
    const status = equipmentStatus(input({ initial: { value: 12_345, date: "2026-01-01", source: "Lectura inicial" } }))
    expect(status.state).toBe("al_dia")
    expect(status.currentReading?.value).toBe(12_345)
  })

  it("sin preventivas: próxima = (piso(L / base) + 1) × base", () => {
    const status = equipmentStatus(input({ readings: [reading(12_345)] }))
    expect(status).toMatchObject({ state: "al_dia", nextReading: 20_000, remaining: 7_655, nextIntervalValue: 20_000 })
    // Justo en un múltiplo no está vencida: la siguiente es la del múltiplo que sigue.
    expect(equipmentStatus(input({ readings: [reading(10_000)] }))).toMatchObject({ nextReading: 20_000, remaining: 10_000 })
  })

  it("con preventiva: próxima = punto sugerido de la última + base", () => {
    const last = { reading: 20_000, date: "2026-05-01", intervalValue: 20_000 }
    const status = equipmentStatus(input({ readings: [reading(24_000)], lastPreventive: last }))
    expect(status).toMatchObject({ state: "al_dia", nextReading: 30_000, remaining: 6_000, nextIntervalValue: 10_000 })
  })

  it("una preventiva hecha algo tarde se redondea a su punto (41.200 km cuenta como la de 40.000)", () => {
    const last = { reading: 41_200, date: "2026-05-01", intervalValue: 40_000 }
    expect(equipmentStatus(input({ readings: [reading(41_500)], lastPreventive: last })).nextReading).toBe(50_000)
  })

  it("el intervalo de la próxima es el que toca en esa lectura (la de 40.000 km se anuncia como tal)", () => {
    const last = { reading: 30_000, date: "2026-05-01", intervalValue: 10_000 }
    expect(equipmentStatus(input({ readings: [reading(31_000)], lastPreventive: last }))).toMatchObject({ nextReading: 40_000, nextIntervalValue: 40_000 })
  })

  describe("umbral exacto del 15 % de la base (km: 1.500)", () => {
    const last = { reading: 20_000, date: "2026-05-01", intervalValue: 20_000 }
    const at = (value: number) => equipmentStatus(input({ readings: [reading(value)], lastPreventive: last }))

    it("falta justo el 15 %: próxima", () => {
      expect(at(28_500)).toMatchObject({ state: "proxima", remaining: 1_500 })
    })

    it("falta un kilómetro más que el 15 %: al día", () => {
      expect(at(28_499)).toMatchObject({ state: "al_dia", remaining: 1_501 })
    })

    it("falta 1: próxima; falta 0: vencida; pasada: vencida con falta negativa", () => {
      expect(at(29_999).state).toBe("proxima")
      expect(at(30_000)).toMatchObject({ state: "vencida", remaining: 0 })
      expect(at(31_000)).toMatchObject({ state: "vencida", remaining: -1_000 })
    })
  })

  describe("umbral exacto del 15 % en horas (base 300 h: 45 h)", () => {
    const last = { reading: 5_400, date: "2026-05-01", intervalValue: 900 }
    const at = (value: number) => equipmentStatus(input({ intervals: HORAS, readings: [reading(value)], lastPreventive: last }))

    it("5.400 h → toca la siguiente a las 5.700 h, anunciada como la de 300 h", () => {
      expect(at(5_500)).toMatchObject({ nextReading: 5_700, nextIntervalValue: 300, state: "al_dia" })
    })

    it("falta 45 h: próxima; falta 46 h: al día", () => {
      expect(at(5_655)).toMatchObject({ state: "proxima", remaining: 45 })
      expect(at(5_654)).toMatchObject({ state: "al_dia", remaining: 46 })
    })
  })

  it("conserva la última preventiva en el resultado", () => {
    const last = { reading: 20_000, date: "2026-05-01", intervalValue: 20_000 }
    expect(equipmentStatus(input({ readings: [reading(21_000)], lastPreventive: last })).lastPreventive).toBe(last)
  })

  it("stateRank ordena vencida → próxima → al día → sin lecturas → sin pauta → baja", () => {
    const shuffled = [...MANT_EQUIPMENT_STATES].reverse().sort((a, b) => stateRank(a) - stateRank(b))
    expect(shuffled).toEqual(["vencida", "proxima", "al_dia", "sin_lecturas", "sin_pauta", "baja"])
  })
})

describe("regla 7 · preventiva duplicada", () => {
  const previous: PreventiveRef[] = [
    { id: "p1", folio: "MP-BIO-0001", reading: 40_000, date: "2026-06-01", intervalValue: 40_000 },
  ]
  const find = (overrides: Partial<Parameters<typeof findDuplicatePreventive>[0]> = {}) =>
    findDuplicatePreventive({ previous, intervalValue: 40_000, reading: 60_000, workDate: "2026-06-08", base: 10_000, ...overrides })

  it("hace 7 días es duplicada y devuelve la anterior para enlazarla", () => {
    expect(find()).toBe(previous[0])
  })

  it("hace 8 días y lejos en lectura no lo es", () => {
    expect(find({ workDate: "2026-06-09" })).toBeNull()
  })

  it("a menos del 10 % de la base en lectura es duplicada aunque haya pasado mucho tiempo", () => {
    expect(find({ workDate: "2026-12-01", reading: 40_999 })?.id).toBe("p1")
    expect(find({ workDate: "2026-12-01", reading: 39_001 })?.id).toBe("p1")
  })

  it("justo el 10 % de la base (1.000 km) ya no cuenta", () => {
    expect(find({ workDate: "2026-12-01", reading: 41_000 })).toBeNull()
    expect(find({ workDate: "2026-12-01", reading: 39_000 })).toBeNull()
  })

  it("otro intervalo no es duplicado", () => {
    expect(find({ intervalValue: 20_000, workDate: "2026-06-02", reading: 40_100 })).toBeNull()
  })

  it("se puede excluir el propio registro (corrección)", () => {
    expect(find({ excludeId: "p1" })).toBeNull()
  })

  it("sin preventivas previas no hay duplicado", () => {
    expect(find({ previous: [] })).toBeNull()
  })
})

describe("regla 11 · equipo en taller", () => {
  const today = "2026-10-28"
  const base = { inWorkshop: true, entryDate: "2026-10-20", workDate: "2026-10-20", updates: [] as Array<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }> }

  it("pide actualizar cada 2 días", () => {
    expect(WORKSHOP_UPDATE_DAYS).toBe(2)
  })

  it("sin novedades desde la correctiva, más de 2 días: sin actualizar, y cuenta los días detenido hasta hoy", () => {
    expect(workshopState(base, today)).toMatchObject({ inWorkshop: true, stale: true, daysStopped: 8, exitDate: null, lastActivityDate: "2026-10-20" })
  })

  it("la última novedad reinicia el plazo", () => {
    const update = (createdDate: string) => ({ ...base, updates: [{ kind: "sigue" as const, createdDate, exitDate: null }] })
    expect(workshopState(update("2026-10-27"), today).stale).toBe(false)
    expect(workshopState(update("2026-10-26"), today).stale).toBe(false) // exactamente 2 días: aún al día
    expect(workshopState(update("2026-10-25"), today).stale).toBe(true) // 3 días: sin actualizar
  })

  it("con varias novedades manda la más reciente, venga en el orden que venga", () => {
    const updates = [
      { kind: "sigue" as const, createdDate: "2026-10-27", exitDate: null },
      { kind: "sigue" as const, createdDate: "2026-10-21", exitDate: null },
    ]
    expect(workshopState({ ...base, updates }, today)).toMatchObject({ stale: false, lastActivityDate: "2026-10-27" })
  })

  it("una correctiva registrada hoy no está sin actualizar", () => {
    expect(workshopState({ ...base, workDate: today, entryDate: today }, today)).toMatchObject({ stale: false, daysStopped: 0 })
  })

  it("al salir, deja de estar en taller y los días detenido son ingreso → salida", () => {
    const state = workshopState({ ...base, updates: [{ kind: "salio", createdDate: "2026-10-24", exitDate: "2026-10-24" }] }, today)
    expect(state).toMatchObject({ inWorkshop: false, stale: false, exitDate: "2026-10-24", daysStopped: 4 })
  })

  it("una correctiva que no dejó el equipo en taller no tiene días detenido ni alerta", () => {
    expect(workshopState({ ...base, inWorkshop: false, entryDate: null }, today)).toMatchObject({ inWorkshop: false, stale: false, daysStopped: null })
  })
})

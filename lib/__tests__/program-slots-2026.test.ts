/**
 * lib/__tests__/program-slots-2026.test.ts
 *
 * El cronograma de las casillas está congelado en TypeScript para no parsear
 * JSON en el camino de una petición. Este archivo es la otra mitad del trato:
 * afirma que la constante sigue siendo lo que el programa declara.
 *
 * No es una precaución teórica. Existe `pdtp:reprogram-2026-schedule`, así que
 * alguien puede mover una celda del cronograma sin tocar este módulo, y el
 * checklist quedaría esperando simulacros en meses que el programa ya no pide.
 */

import { describe, expect, it } from "vitest"
import catalog from "@/db/seed/pdtp-catalog-2026.json"
import {
  DRILL_PDTP_ACTIVITY_NUMBER,
  DRILL_SLOTS_2026,
  GRD_MEETING_PDTP_ACTIVITY_NUMBER,
  GRD_MEETING_SLOTS_2026,
  PROGRAM_SLOT_YEAR,
  resolveProgramSlotYear,
} from "@/lib/prevention/program-slots-2026"

type CatalogEntry = { n: number; schedule?: { month: number; week: number }[] }
type CatalogFile = { activities: CatalogEntry[] }

function scheduleFor(activityNumber: number) {
  const entry = (catalog as CatalogFile).activities.find((item) => item.n === activityNumber)
  if (!entry) throw new Error(`El catálogo PDTP no declara la actividad N°${activityNumber}.`)
  return (entry.schedule ?? []).map((cell) => ({ month: cell.month, week: cell.week }))
}

describe("las casillas congeladas coinciden con el cronograma del programa", () => {
  it("N°84 — simulacros", () => {
    expect(DRILL_SLOTS_2026.map((s) => ({ month: s.month, week: s.week })))
      .toEqual(scheduleFor(DRILL_PDTP_ACTIVITY_NUMBER))
  })

  it("N°81 — actas del CGRD", () => {
    expect(GRD_MEETING_SLOTS_2026.map((s) => ({ month: s.month, week: s.week })))
      .toEqual(scheduleFor(GRD_MEETING_PDTP_ACTIVITY_NUMBER))
  })

  it("la clave de slot usa el mismo formato que capacitación", () => {
    expect(DRILL_SLOTS_2026.map((s) => s.slotKey)).toEqual(["m03-w3", "m09-w3"])
    expect(GRD_MEETING_SLOTS_2026.map((s) => s.slotKey)).toEqual(["m02-w1", "m03-w1", "m04-w1", "m05-w1"])
  })

  it("un año sin cronograma declarado cae al único que existe", () => {
    expect(resolveProgramSlotYear(2027)).toBe(PROGRAM_SLOT_YEAR)
    expect(resolveProgramSlotYear("no es un año")).toBe(PROGRAM_SLOT_YEAR)
    expect(resolveProgramSlotYear(2026)).toBe(2026)
  })
})

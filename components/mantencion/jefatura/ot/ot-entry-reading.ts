import { formatNumber, formatReading, meterName, parseReadingInput } from "@/lib/mantencion/format"
import { checkReading, currentReading, type ReadingJump } from "@/lib/mantencion/readings"
import type { MantReading, MantUnit } from "@/lib/mantencion/types"
import { formatDate } from "@/lib/utils"

/**
 * La lectura del «Registrar ingreso» desde el PC, con las mismas reglas que la app del mecánico
 * (`components/mantencion/app/ot-entry-form.tsx`) y el registro desde el PC (`record-step-lectura.tsx`):
 * `parseReadingInput` para leer el texto (el punto es de miles: «8.100» son 8100, no 8,1), `checkReading` para
 * la regla 2 (no baja ni pasa la lectura vigente de su fecha) y su salto (regla 3), que se confirma.
 * Es presentación: el servidor sólo exige que haya un valor dentro del rango.
 */

/** Tope de la columna: el mismo que `workOrderEntrySchema` (`lib/mantencion/contracts.ts`). */
export const ENTRY_READING_MAX = 99_999_999

/** Las lecturas vigentes del equipo (y la inicial de su ficha) contra las que se contrasta el ingreso. */
export interface EntryReadings {
  readings: MantReading[]
  initial: MantReading | null
}

export type EntryReadingResult =
  | { ok: true; value: number; jump: ReadingJump | null }
  | { ok: false; message: string }

/**
 * El texto del campo tal como se guarda en el estado del formulario (sin miles y con la coma pendiente), a partir de
 * lo guardado en la OT. Pasa por la coma decimal: «7600.5» sería, para `parseReadingInput`, un decimal sólo por tener
 * un dígito tras el punto.
 */
export function readingToText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ""
  return parseReadingInput(String(value).replace(".", ",")).stored
}

/** La última lectura conocida del equipo: la del registro más reciente o, sin registros, la inicial de la ficha. */
export function lastKnownReading(known: EntryReadings | null): MantReading | null {
  return known ? currentReading(known.readings, known.initial) : null
}

/** «Última lectura registrada: 7.501 h · 20-11-2026», o que no hay; `null` si no se pudo cargar el equipo. */
export function lastReadingText(known: EntryReadings | null, unit: MantUnit): string | null {
  if (!known) return null
  const last = lastKnownReading(known)
  return last ? `Última lectura registrada: ${formatReading(last.value, unit)} · ${formatDate(last.date)}` : "No hay lecturas anteriores de este equipo."
}

/**
 * Qué dice la lectura escrita para el ingreso del día `workDate` (`YYYY-MM-DD`, la fecha de ingreso en hora de Chile):
 * falta o no se entiende, pasa el tope, choca con otra lectura (`message` ya dice cuál y de qué fecha), o es válida
 * y trae el salto por confirmar si lo hay.
 */
export function checkEntryReading(input: { text: string; unit: MantUnit; workDate: string; known: EntryReadings | null }): EntryReadingResult {
  const { value } = parseReadingInput(input.text)
  if (value === null) return { ok: false, message: `Ingresa la lectura del ${meterName(input.unit)}.` }
  if (value > ENTRY_READING_MAX) return { ok: false, message: `La lectura no puede pasar de ${formatNumber(ENTRY_READING_MAX)}.` }
  if (!input.known) return { ok: true, value, jump: null }
  const check = checkReading({ value, workDate: input.workDate, unit: input.unit, readings: input.known.readings, initial: input.known.initial })
  return check.ok ? { ok: true, value, jump: check.jump } : { ok: false, message: check.message }
}

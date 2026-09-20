/**
 * lib/prevention/program-slots-2026.ts
 *
 * Las casillas del programa 2026 para simulacros (N°84) y actas del CGRD
 * (N°81): lo que se espera que ocurra, por faena y por año.
 *
 * **Por qué una constante y no una lectura del JSON en runtime.** El
 * cronograma vive en `db/seed/pdtp-catalog-2026.json`, que es dato del
 * programa; parsearlo en el camino de una petición acoplaría el módulo al
 * archivo y pagaría el parseo en cada request. Se congela acá, como ya hace
 * `training-occurrences-catalog.ts` con el catálogo anual de capacitación.
 *
 * **Y por qué eso no es una copia que se va a desincronizar.** Existe
 * `pdtp:reprogram-2026-schedule`: el cronograma se puede reprogramar, así que
 * la deriva no es teórica. `program-slots-2026.test.ts` lee el JSON y afirma,
 * celda por celda, que esta constante coincide con las actividades N°84 y
 * N°81. Si alguien reprograma y no actualiza acá, CI lo dice.
 */

/** Número de actividad PDTP de los simulacros de emergencia. */
export const DRILL_PDTP_ACTIVITY_NUMBER = 84
/** Número de actividad PDTP de las actas de reunión del CGRD. */
export const GRD_MEETING_PDTP_ACTIVITY_NUMBER = 81

export const PROGRAM_SLOT_YEAR = 2026 as const

export interface ProgramSlot {
  /** `m%02d-w%d`, el mismo formato que usan las ocurrencias de capacitación. */
  slotKey: string
  month: number
  week: number
}

function slot(month: number, week: number): ProgramSlot {
  return { slotKey: `m${String(month).padStart(2, "0")}-w${week}`, month, week }
}

/** N°84 — «Simulacros». Dos al año: marzo y septiembre. */
export const DRILL_SLOTS_2026: readonly ProgramSlot[] = [
  slot(3, 3),
  slot(9, 3),
]

/** N°81 — «Actas de reunión CGRD de acuerdo a DS.N°44». Cuatro, de febrero a mayo. */
export const GRD_MEETING_SLOTS_2026: readonly ProgramSlot[] = [
  slot(2, 1),
  slot(3, 1),
  slot(4, 1),
  slot(5, 1),
]

/**
 * El año de las casillas. Fuera de 2026 no hay cronograma declarado, así que
 * se cae al único que existe en vez de generar un año vacío en silencio.
 */
export function resolveProgramSlotYear(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  return Number.isInteger(parsed) && parsed === PROGRAM_SLOT_YEAR ? parsed : PROGRAM_SLOT_YEAR
}

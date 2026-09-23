/**
 * lib/prevention/program-slots-2026.ts
 *
 * Las casillas del programa 2026 para simulacros (N°84), actas del CGRD
 * (N°81), alcotest (N°30/31 y N°32) y la evaluación cuantitativa de higiene
 * (N°45): lo que se espera que ocurra, por faena y por año.
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
 * celda por celda, que esta constante coincide con las actividades del
 * catálogo. Si alguien reprograma y no actualiza acá, CI lo dice.
 */

/** Número de actividad PDTP de los simulacros de emergencia. */
export const DRILL_PDTP_ACTIVITY_NUMBER = 84
/** Número de actividad PDTP de las actas de reunión del CGRD. */
export const GRD_MEETING_PDTP_ACTIVITY_NUMBER = 81
/** N°45 — «Evaluación cuantitativas por mutual»: la medición de exposición. */
export const HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER = 45
/**
 * N°30 y N°31 tienen el mismo texto y el mismo cronograma; sólo difieren en el
 * responsable declarado (PRF vs Sup/JT). Cuál de las dos se acredita lo decide
 * el rol de quien completa la casilla, no la casilla: por eso son dos números y
 * una sola serie de celdas.
 */
export const ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS = [30, 31] as const
/** N°32 — «Envío registros alcotest, según DO-48». */
export const ALCOTEST_DISPATCH_PDTP_ACTIVITY_NUMBER = 32

/** Roles que responden por la N°30 — el propio PRF. */
const ALCOTEST_PRF_ROLES = new Set(["prevencionista_faena", "prevencionista"])
/** Roles que responden por la N°31 — quien no es PRF pero controla en terreno. */
const ALCOTEST_SUP_JT_ROLES = new Set(["supervisor_terreno", "jefe_terreno"])

/**
 * Cuál de las dos actividades de la serie de control (N°30 o N°31) corresponde
 * a quien actúa sobre la casilla, según su rol. `null` si el rol no mapea a
 * ninguna.
 *
 * Vive junto a las constantes de la serie porque la usan los dos lados de la
 * casilla: el registro del control (`prevention-alcotest.ts`, que la reexporta)
 * y la declaración de «no aplica»/«no hecha» (`prevention-alcotest-slots.ts`).
 * Tenerla en uno de los dos servicios obligaba al otro a importarlo en ciclo.
 */
export function resolveAlcotestActivityNumber(roles: readonly string[]): number | null {
  if (roles.some((role) => ALCOTEST_PRF_ROLES.has(role))) return ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS[0]
  if (roles.some((role) => ALCOTEST_SUP_JT_ROLES.has(role))) return ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS[1]
  return null
}

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
 * N°45 — «Evaluación cuantitativas por mutual». Una sola celda al año:
 * febrero, semana 2. La cumple la primera medición de exposición del año en la
 * faena, que ya exige el informe de laboratorio como archivo real.
 */
export const HYGIENE_MEASUREMENT_SLOTS_2026: readonly ProgramSlot[] = [
  slot(2, 2),
]

/**
 * N°30/31 — «Realizar alcotest». Doce al año: enero en semana 4 y el resto en
 * semana 3.
 */
export const ALCOTEST_CONTROL_SLOTS_2026: readonly ProgramSlot[] = [
  slot(1, 4),
  ...Array.from({ length: 11 }, (_, index) => slot(index + 2, 3)),
]

/**
 * N°32 — «Envío registros alcotest, según DO-48». Once: arranca en febrero
 * porque cada envío reporta el mes anterior, así que enero no tiene qué enviar.
 */
export const ALCOTEST_DISPATCH_SLOTS_2026: readonly ProgramSlot[] = Array.from(
  { length: 11 },
  (_, index) => slot(index + 2, 1),
)

/**
 * El año de las casillas. Fuera de 2026 no hay cronograma declarado, así que
 * se cae al único que existe en vez de generar un año vacío en silencio.
 */
export function resolveProgramSlotYear(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  return Number.isInteger(parsed) && parsed === PROGRAM_SLOT_YEAR ? parsed : PROGRAM_SLOT_YEAR
}

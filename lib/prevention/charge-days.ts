/**
 * Días de cargo por incapacidad permanente o muerte (DS 44, tasa de gravedad).
 *
 * Los días de cargo son una construcción ESTADÍSTICA distinta de los días
 * efectivos de ausencia: un trabajador fallecido tiene `absenceDays = 0` y
 * `chargeDays = 6000`. Ambos suman al numerador de la gravedad, pero no son lo
 * mismo y nunca deben mezclarse — inventar días de ausencia para que una
 * fatalidad entre al indicador es falsear el registro.
 *
 * La tabla se versiona aparte de la fórmula porque puede cambiar sin que cambie
 * el álgebra del indicador: cada cálculo histórico debe poder reproducirse con
 * la tabla que estaba vigente.
 */

export const CHARGE_DAYS_TABLE_VERSION = "isp-2026-v1"

/** Muerte. */
export const FATAL_CHARGE_DAYS = 6000

/** Incapacidad permanente TOTAL: mismo cargo que la muerte. */
export const PERMANENT_TOTAL_CHARGE_DAYS = 6000

/**
 * Resultado del accidente que determina días de cargo automáticos.
 *
 * `permanent_partial` NO se resuelve aquí: su cargo depende del porcentaje de
 * incapacidad según la tabla del ISP, y el modelo de incidentes todavía no
 * captura ese porcentaje (`actualSeverity` no distingue incapacidades
 * permanentes). Hasta que exista ese campo, el cargo parcial se ingresa a mano
 * y esta función devuelve `null` para no fabricar una cifra.
 */
export type ChargeDaysOutcome = "fatal" | "permanent_total" | "permanent_partial" | "other"

export function chargeDaysForOutcome(outcome: ChargeDaysOutcome): number | null {
  switch (outcome) {
    case "fatal": return FATAL_CHARGE_DAYS
    case "permanent_total": return PERMANENT_TOTAL_CHARGE_DAYS
    // Requiere el porcentaje de incapacidad; ver el comentario del tipo.
    case "permanent_partial": return null
    default: return null
  }
}

/**
 * Días de cargo que corresponden automáticamente a la severidad registrada en
 * el incidente. Hoy sólo la fatalidad es derivable: el enum `actualSeverity`
 * (`none`/`minor`/`medical_treatment`/`lost_time`/`serious`/`fatal`) no
 * distingue incapacidades permanentes de una lesión con tiempo perdido.
 */
export function automaticChargeDaysForSeverity(actualSeverity: string): number | null {
  return actualSeverity === "fatal" ? FATAL_CHARGE_DAYS : null
}

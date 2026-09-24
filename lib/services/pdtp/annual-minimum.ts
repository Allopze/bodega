/**
 * Piso anual de una actividad "cuando corresponda" (`minAnnualExecutions`).
 *
 * Una actividad a demanda se mide por casos: la inducción (N°15) por las
 * obligaciones que vencieron, su evaluación (N°16) por los trabajadores nuevos
 * del mes. Si en el año no hubo casos, la actividad no aporta nada al
 * indicador —ni a favor ni en contra—, y un programa que se firma prometiendo
 * "cuando corresponda" queda sin ninguna ejecución exigible.
 *
 * El piso cierra ese hueco sin alterar lo que ya se mide:
 *
 * - `measured` son las unidades que la actividad ya puso en el denominador del
 *   año (casos vencidos, padrón de los meses con ingresos). Si alcanzan el
 *   mínimo, el piso no agrega nada: esos casos ya se exigen, con su regla.
 * - Lo que falte (`minimum - measured`) se agrega al denominador.
 * - Se acredita con lo realizado que todavía no contó (`performed - measured`):
 *   una inducción por cambio de cargo, que no nace de un acta de trabajador
 *   nuevo, cuenta para el piso aunque no tenga caso propio.
 *
 * Es por faena y por año, igual que el resto del indicador.
 */
export function pdtpAnnualMinimumFloor(input: {
  minimum: number | null | undefined
  /** Unidades que la actividad ya aportó al denominador del año. */
  measured: number
  /** Ejecuciones aprobadas o cierres completados en el año, contaran o no. */
  performed: number
}): { planned: number; executed: number } {
  const minimum = input.minimum ?? 0
  if (minimum <= 0) return { planned: 0, executed: 0 }
  const shortfall = Math.max(0, minimum - input.measured)
  if (shortfall === 0) return { planned: 0, executed: 0 }
  const uncounted = Math.max(0, input.performed - input.measured)
  return { planned: shortfall, executed: Math.min(shortfall, uncounted) }
}

/** Mes (1-12) en que vence el piso anual: el cierre del año del programa. */
export const PDTP_ANNUAL_MINIMUM_MONTH = 12

/** Texto corto de la frecuencia: "Cuando corresponda · mínimo 1 al año". */
export function describePdtpAnnualMinimum(minimum: number | null | undefined): string | null {
  if (!minimum || minimum < 1) return null
  return `mínimo ${minimum} al año`
}

/** Modos de indicador en que el piso anual tiene significado (medidos por caso). */
export const PDTP_ANNUAL_MINIMUM_INDICATOR_MODES = ["closed_on_time", "coverage"] as const

export function pdtpAnnualMinimumAllowed(scheduleMode: string | null | undefined, indicatorMode: string | null | undefined): boolean {
  return (scheduleMode === "on_demand" || scheduleMode === "triggered")
    && (PDTP_ANNUAL_MINIMUM_INDICATOR_MODES as readonly string[]).includes(indicatorMode ?? "")
}

/**
 * Ralentí: % en vacío = horas en vacío ÷ horas de funcionamiento, siempre desde
 * horas crudas. Sin horas de funcionamiento no hay porcentaje (null), no 0 %.
 */
export function idlePct(idleHours: number, operatingHours: number): number | null {
  if (!(operatingHours > 0)) return null
  return (idleHours / operatingHours) * 100
}

/** L/h según telemetría: litros totales ÷ horas de funcionamiento (V-08). */
export function telemetryLitersPerHour(litersWorking: number | null, litersIdle: number | null, operatingHours: number): number | null {
  if (litersWorking === null && litersIdle === null) return null
  if (!(operatingHours > 0)) return null
  return ((litersWorking ?? 0) + (litersIdle ?? 0)) / operatingHours
}

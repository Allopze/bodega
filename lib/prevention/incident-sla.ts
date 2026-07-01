// SLA de notificación de incidentes. Solo accidentes graves/fatales tienen un
// límite legal de notificación "inmediata"; 24h es el default operativo.
// ponytail: umbral fijo por severidad. Si la faena necesita SLAs distintos
// por tipo de faena/cliente, mover a config por worksite.
export const INCIDENT_SLA_HOURS: Record<string, number> = {
  grave: 24,
  fatal: 24,
}

export function incidentSlaBreached(input: {
  type: string
  severity: string
  occurredAt: string
  createdAt: string
}): boolean {
  if (input.type !== "accidente") return false
  const limitHours = INCIDENT_SLA_HOURS[input.severity]
  if (!limitHours) return false
  const elapsedMs = new Date(input.createdAt).getTime() - new Date(input.occurredAt).getTime()
  return elapsedMs > limitHours * 60 * 60 * 1000
}
